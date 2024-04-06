/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */

'use strict';
function entity_inertia(entity, mass) {
    const scaleX = entity.scale ? entity.scale.x : 1;
    const scaleY = entity.scale ? entity.scale.y : 1;
    
    // Inertia tensor about the center (https://en.wikipedia.org/wiki/List_of_moments_of_inertia)
    // rect: 1/12 * m * (w^2 + h^2)
    // disk: m * (w/2)^2
    if (mass === undefined) { mass = entity_mass(entity); }

    if (mass === 0) { $error('entity.mass == 0 while computing moment of inertia'); }
    if (scaleX === 0) { $error('entity.scale.x == 0 while computing moment of inertia'); }
    if (is_nan(scaleX)) { $error('NaN entity.scale.x while computing moment of inertia'); }
    if (entity.size.x === 0) { $error('entity.size.x == 0 while computing moment of inertia'); }
    if (is_nan(entity.size.x)) { $error('NaN entity.size.x while computing moment of inertia'); }
    
    if (entity.shape === 'rect') {
        return mass * ($square(entity.size.x * scaleX) + $square(entity.size.y * scaleY)) * (1 / 12);
    } else {
        return mass * $square(entity.size.x * scaleX * 0.5);
    }
}


function entity_mass(entity) {
    return entity_area(entity) * ((entity.density !== undefined) ? entity.density : 1);
}


function entity_simulate(entity, dt, region, border_behavior) {
    if (is_nan(entity.spin)) { $error('nan entity.spin'); }
    if (is_nan(entity.torque)) { $error('nan entity.torque'); }

    // Assume this computation takes 0.01 ms. We have no way to time it
    // properly, but this at least gives some feedback in the profiler
    // if it is being called continuously.
    $physicsTimeTotal += 0.01;
    
    if (dt === undefined) { dt = 1; }
    if (entity.density === Infinity) { return; }
    
    const mass = entity_mass(entity);
    if (mass <= 0) { $error('Mass must be positive in entity_simulate()'); }
    const imass = 1 / mass;
    const iinertia = 1 / entity_inertia(entity, mass);
    const vel = entity.vel, pos = entity.pos, force = entity.force;

    // Drag should fall off with the time step to remain constant
    // as the time step varies (in the absence of acceleration)
    const k = $Math.pow(1 - entity.drag, dt);
    
    // Integrate
    const accX = force.x * imass;
    vel.x = vel.x * k + accX * dt;
    pos.x += vel.x * dt;
    force.x = 0;

    const accY = force.y * imass;
    vel.y = vel.y * k + accY * dt;
    pos.y += vel.y * dt;
    force.y = 0;

    if (pos.z !== undefined) {
        const accZ = (force.z || 0) * imass;
        vel.z = (vel.z || 0) * k + accZ * dt;
        pos.z += vel.z * dt;
        force.z = 0;
    }

    const twist = entity.torque * iinertia;

    // Integrate
    entity.spin  *= k;
    entity.spin  += twist * dt;
    entity.angle += entity.spin * dt

    // Zero for next step
    entity.torque = 0;

    if (region) {
        if (region.shape && region.shape !== 'rect') {
            $error('The region for entity_simulate() must be a "rect"');
        }

        const func = (border_behavior === 'loop') ? loop : clamp;
        entity.pos.x = func(entity.pos.x, (region.pos ? region.pos.x : 0) - 0.5 * region.size.x, (region.pos ? region.pos.x : 0) + 0.5 * region.size.x);
        entity.pos.y = func(entity.pos.y, (region.pos ? region.pos.y : 0) - 0.5 * region.size.y, (region.pos ? region.pos.y : 0) + 0.5 * region.size.y);
    }

    entity_update_children(entity);
}


function entity_apply_force(entity, worldForce, worldPos) {
    worldPos = worldPos || entity.pos;
    entity.force.x += worldForce.x;
    entity.force.y += worldForce.y;
    const offsetX = worldPos.x - entity.pos.x;
    const offsetY = worldPos.y - entity.pos.y;
    entity.torque += -rotation_sign() * (offsetX * worldForce.y - offsetY * worldForce.x);
}


function entity_apply_impulse(entity, worldImpulse, worldPos) {
    worldPos = worldPos || entity.pos;
    const invMass = 1 / entity_mass(entity);
    entity.vel.x += worldImpulse.x * invMass;
    entity.vel.y += worldImpulse.y * invMass;

    const inertia = entity_inertia(entity);
    const offsetX = worldPos.x - entity.pos.x;
    const offsetY = worldPos.y - entity.pos.y;

    entity.spin += -rotation_sign() * (offsetX * worldImpulse.y - offsetY * worldImpulse.x) / inertia;
}


function entity_move(entity, pos, angle) {
    if (pos !== undefined) {
        entity.vel.x = pos.x - entity.pos.x;
        entity.vel.y = pos.y - entity.pos.y;
        entity.pos.x = pos.x;
        entity.pos.y = pos.y;
    }
      
    if (angle !== undefined) {
        // Rotate the short way
        entity.spin = loop(angle - entity.angle, -PI, $Math.PI);
        entity.angle = angle;
    }
}



function make_contact_group() {
    // Matter.js uses negative numbers for non-colliding
    // groups, so we negate them everywhere to make it more
    // intuitive for the user.
    return -$Physics.Body.nextGroup(true);
}


/* Density scale multiplier used to map to the range where
   matter.js constants are tuned for. Using a power of 2 makes
   the round trip between matter and quadplay more stable.
   This is about 0.001, which is the default density in matter.js.
*/
var $PHYSICS_MASS_SCALE     = Math.pow(2, -10);
var $PHYSICS_MASS_INV_SCALE = Math.pow(2,  10);
var $physicsContextIndex = 0;

function $physicsUpdateContact(physics, contact, pair) {
    const activeContacts = pair.activeContacts;
    
    contact.normal.x = pair.collision.normal.x;
    contact.normal.y = pair.collision.normal.y;
    contact.point0.x = activeContacts[0].vertex.x;
    contact.point0.y = activeContacts[0].vertex.y;

    // For debugging contacts
    // $console.log(" update: ", contact.point0.x);
    
    if (activeContacts.length > 1) {
        if (! contact.point1) { contact.point1 = {}; }
        contact.point1.x = activeContacts[1].vertex.x;
        contact.point1.y = activeContacts[1].vertex.y;
    } else {
        contact.point1 = undefined;
    }
    contact.depth = pair.collision.depth;
    contact.$lastRealContactFrame = physics.$frame;
}


function make_physics(options) {
    const engine = $Physics.Engine.create();
    const physics = Object.seal({
        $name:                 "physics" + ($physicsContextIndex++),
        $engine:               engine,
        $contactCallbackArray: [],
        $newContactArray:      [], // for firing callbacks and visualization. wiped every frame

        $frame:                0,

        // Lock for when within simulation
        $inSimulate:           false,
        
        // To be removed when physics_simulate ends
        $removeEntityArray:   [],
        
        // $brokenContactQueue[0] is an array of contacts that broke $brokenContactQueue.length - 1
        // frames ago (but may have been reestablished). Add empty arrays to this queue to maintain
        // old contacts for more frames so that bouncing/sliding contact feels more robust.
        $brokenContactQueue:   [[], [], [], []],
        
        // Maps bodies to maps of bodies to contacts.
        $entityContactMap:     new Map(), 

        // All entities in this physics context
        $entityArray:          []})
    
    options = options || {}
   
    if (options.gravity) {
        engine.world.gravity.x = options.gravity.x;
        engine.world.gravity.y = options.gravity.y;
    } else {
        engine.world.gravity.y = -up_y();
    }
      
    engine.world.gravity.scale = 0.001; // default 0.001
    engine.enableSleeping = true;
    if (options.allow_sleeping === false || options.allowSleeping === false) {
        engine.enableSleeping = false;
    }

    // Higher improves compression under large stacks or
    // small objects.  Too high causes instability.
    engine.positionIterations   = 12; // default 6

    // Higher improves processing of fast objects and thin walls.
    // Too high causes instability.
    engine.velocityIterations   = 14; // default 4
    engine.constraintIterations = 4;  // default 2. Higher lets more chained constraints propagate.

    // Extra constraints enforced by quadplay
    engine.customAttachments = [];
        
    // Allows slowmo, etc.
    // engine.timing.timeScale = 1

    $Physics.Events.on(engine, 'collisionStart', function (event) {
        const pairs = event.pairs;
        for (let i = 0; i < pairs.length; ++i) {
            const pair = pairs[i];
            const activeContacts = pair.activeContacts;

            // Create the map entries if they do not already exist
            let mapA = physics.$entityContactMap.get(pair.bodyA);
            if (mapA === undefined) { physics.$entityContactMap.set(pair.bodyA, mapA = new Map()); }

            let mapB = physics.$entityContactMap.get(pair.bodyB);
            if (mapB === undefined) { physics.$entityContactMap.set(pair.bodyB, mapB = new Map()); }
            
            let contact = mapA.get(pair.bodyB);
            
            if (! contact) {
                // This new contact will not appear in the
                // collisionActive event for one frame, so update
                // the properties right now
                contact = {
                    entityA: pair.bodyA.entity,
                    entityB: pair.bodyB.entity,
                    normal:  {x: pair.collision.normal.x, y: pair.collision.normal.y},
                    point0:  {x: activeContacts[0].vertex.x, y: activeContacts[0].vertex.y},
                    point1:  (activeContacts.length === 1) ? undefined : {x: activeContacts[1].vertex.x, y: activeContacts[1].vertex.y},
                    depth:   pair.collision.depth
                }

                // For use in collision callbacks
                physics.$newContactArray.push(contact);

                // For use in queries
                mapA.set(pair.bodyB, contact);
                mapB.set(pair.bodyA, contact);

                // for debugging collisions
                //$console.log(physics.$frame + ' +begin ' + contact.entityA.name + " & " + contact.entityB.name);
            } else {
                $console.assert(mapB.get(pair.bodyA), 'Internal error: Mismatched contact pair in physics simulation');
                // ...else: this contact already exists and is in the maps because it was recently active.
                // it is currently scheduled in the broken contact queue. Update the data; the Active
                // event will not be called by Matter.js

                // for debugging collisions
                //$console.log(physics.$frame + ' resume ' + contact.entityA.name + " & " + contact.entityB.name);
                $physicsUpdateContact(physics, contact, pair);
            }
            
            contact.$lastRealContactFrame = physics.$frame;                
        }
    });

    $Physics.Events.on(engine, 'collisionActive', function (event) {
        const pairs = event.pairs;
        for (let i = 0; i < pairs.length; ++i) {
            const pair = pairs[i];

            // We could fetch from A and then B or B and then A. Both give the same
            // result.
            const contact = physics.$entityContactMap.get(pair.bodyA).get(pair.bodyB);

            if (! contact) {
                // Something went wrong and matter.js has just updated us about a
                // contact that is no longer active. Ignore it.
                continue;
            }
            
            // for debugging collisions
            // $console.log(physics.$frame + ' active ' + contact.entityA.name + " & " + contact.entityB.name);
            $physicsUpdateContact(physics, contact, pair);
        }
    });

    $Physics.Events.on(engine, 'collisionEnd', function (event) {
        // Schedule collisions for removal
        const pairs = event.pairs;
        const removeArray = last_value(physics.$brokenContactQueue);
        for (let i = 0; i < pairs.length; ++i) {
            const pair = pairs[i];

            if (pair.isActive) {
                // Active contacts should never end
                continue;
            }
            
            // Find the contact (Note that it may have already been
            // removed, or the object itself may have been removed
            // from physics in a previous frame)
            const map = physics.$entityContactMap.get(pair.bodyA);
            if (map) {
                const contact = map.get(pair.bodyB);
                
                // If not already removed
                if (contact) {
                    // A potential improvement to add here later: if
                    // moving with high velocity away from the contact,
                    // then maybe end the contact immediately
                    
                    // for debugging collisions
                    //$console.log(physics.$frame + ' (brk)  ' + contact.entityA.name + " & " + contact.entityB.name);
                    
                    // Schedule the contact for removal. It can gain a reprieve if is updated
                    // before it hits the front of the queue.
                    removeArray.push(contact);
                }
            } // if map
        }
    });
        
    return physics;
}


function physics_add_entity(physics, entity) {
    if (! physics) { $error("physics context cannot be nil"); }
    if (! physics.$engine) { $error("First argument to physics_add_entity() must be a physics context."); }
    if (entity.$body) { $error("This entity is already in a physics context"); }
    if (entity.density <= 0) { $error("The entity in physics_add_entity() must have nonzero density"); }

    push(physics.$entityArray, entity);
    const engine = physics.$engine;
   
    const params = {isStatic: entity.density === Infinity};

    switch (entity.shape) {
    case "rect":
        entity.$body = $Physics.Bodies.rectangle(entity.pos.x, entity.pos.y, entity.size.x * entity.scale.x, entity.size.y * entity.scale.y, params);
        break;
        
    case "disk":
        entity.$body = $Physics.Bodies.circle(entity.pos.x, entity.pos.y, 0.5 * entity.size.x * entity.scale.x, params);
        break;

    default:
        $error('Unsupported entity shape for physics_add_entity(): "' + entity.shape + '"');
    }

    entity.$body.collisionFilter.group = -entity.contact_group;
    entity.$body.entity = entity;
    entity.$body.slop = 0.075; // 0.05 is the default. Increase to make large object stacks more stable.
    entity.$attachmentArray = [];
    $Physics.World.add(engine.world, entity.$body);

    $bodyUpdateFromEntity(entity.$body);

    return entity;
}


function physics_remove_all(physics) {
    // Remove all (removing mutates the
    // array, so we have to clone it first!)
    const originalArray = clone(physics.$entityArray);
    for (let a = 0; a < originalArray.length; ++a) {
        physics_remove_entity(physics, originalArray[a]);
    }
    
    // Shouldn't be needed, but make sure everything is really gone
    $Physics.Composite.clear(physics.$engine.world, false, true);
}


function physics_remove_entity(physics, entity) {
    if (entity === undefined) {
        $error('nil entity in physics_remove_entity');
    }
    
    if (! entity.$body) { return; }

    if (physics.$inSimulate) {
        // Simulation lock
        physics.$removeEntityArray.push(entity);
        return;
    }
    
    // Remove all attachments (removing mutates the
    // array, so we have to clone it first!)
    const originalArray = clone(entity.$attachmentArray);
    for (let a = 0; a < originalArray.length; ++a) {
        physics_detach(physics, originalArray[a]);
    }

    // Remove all contacts that we are maintaining.  It is OK to have
    // contacts in the broken removal queue because that ignores the
    // case where the bodies are no longer present

    // New contacts:
    const newContactArray = physics.$newContactArray;
    for (let c = 0; c < newContactArray.length; ++c) {
        const contact = newContactArray[c];
        if (contact.entityA === entity || contact.entityB === entity) {
            // Fast remove and shrink
            newContactArray[c] = last_value(newContactArray);
            --newContactArray.length;
            --c;
        }
    }

    // Maintained contacts:
    const body = entity.$body;
    const map = physics.$entityContactMap.get(body);
    if (map) {
        for (const otherBody of map.keys()) {
            // Remove the reverse pointers
            const otherMap = physics.$entityContactMap.get(otherBody);
            otherMap.delete(body);
        }
        // Remove the entire map for body, so that
        // body can be garbage collected
        physics.$entityContactMap.delete(body);
    }
    
    $Physics.World.remove(physics.$engine.world, body, true);
    fast_remove_value(physics.$entityArray, entity);
    entity.$body = undefined;
    entity.$attachmentArray = undefined;
}

   
// internal   
function $entityUpdateFromBody(entity) {
    const S = rotation_sign();
    
    const body     = entity.$body;
    entity.pos.x   = body.position.x;
    entity.pos.y   = body.position.y;
    entity.vel.x   = body.velocity.x;
    entity.vel.y   = body.velocity.y;
    entity.force.x = body.force.x * $PHYSICS_MASS_INV_SCALE;
    entity.force.y = body.force.y * $PHYSICS_MASS_INV_SCALE;
    entity.spin    = body.angularVelocity * S;
    entity.angle   = body.angle * S;
    entity.torque  = body.torque * $PHYSICS_MASS_INV_SCALE * S;

    if (entity.physics_sleep_state === 'vigilant') {
        if (body.isSleeping) { $Physics.Sleeping.set(body, false); }
    } else {
        if (entity.physics_sleep_state === 'awake' && body.isSleeping) {
            // On falling asleep, zero velocity
            entity.vel.x = 0; entity.vel.y = 0; entity.spin = 0;
            $Physics.Body.setVelocity(body, entity.vel);
            $Physics.Body.setAngularVelocity(body, entity.spin);
        }
        entity.physics_sleep_state = body.isSleeping ? 'sleeping' : 'awake';
    }
    /*
    // The physics update would never change these:
    entity.density = body.density
    entity.restitution    = body.restitution
    entity.friction       = body.friction
    entity.drag           = body.frictionAir
    entity.stiction_factor = body.frictionStatic
    */
}


// internal   
function $bodyUpdateFromEntity(body) {
    const entity  = body.entity;

    // For numerical stability, do not set properties unless they appear to have changed
    // on the quadplay side

    const changeThreshold = 0.00001;
    let awake = entity.physics_sleep_state === 'vigilant' || entity.physics_sleep_state === 'awake';
    const S = rotation_sign();

    // Wake up on changes
    if ($Math.abs(body.position.x - entity.pos.x) > changeThreshold ||
        $Math.abs(body.position.y - entity.pos.y) > changeThreshold) {
        $Physics.Body.setPosition(body, entity.pos)
        awake = true;
    }
    
    // Must set velocity after position, because matter.js is a vertlet integrator
    if ($Math.abs(body.velocity.x - entity.vel.x) > changeThreshold ||
        $Math.abs(body.velocity.y - entity.vel.y) > changeThreshold) {
        // Note: a future Matter.js API will change body.velocity and require using body.getVelocity
        $Physics.Body.setVelocity(body, entity.vel);
        awake = true;
    }

    if ($Math.abs(body.angularVelocity - entity.spin * S) > changeThreshold) {
        $Physics.Body.setAngularVelocity(body, entity.spin * S);
        awake = true;
    }

    if ($Math.abs(body.angle - entity.angle * S) > changeThreshold) {
        $Physics.Body.setAngle(body, entity.angle * S);
        awake = true;
    }

    if (! body.isStatic) {
        const d = entity.density * $PHYSICS_MASS_SCALE;
        if ($Math.abs(body.density - d) > changeThreshold) {
            $Physics.Body.setDensity(body, d);
            awake = true;
        }
    }

    body.collisionFilter.group = -entity.contact_group;
    body.collisionFilter.mask  = entity.contact_hit_mask;
    body.collisionFilter.category = entity.contact_category_mask;
         
    body.force.x = entity.force.x * $PHYSICS_MASS_SCALE;
    body.force.y = entity.force.y * $PHYSICS_MASS_SCALE;
    body.torque  = entity.torque * S * $PHYSICS_MASS_SCALE;

    body.friction       = entity.friction;
    body.frictionStatic = entity.stiction_factor;
    body.frictionAir    = entity.drag;
    body.restitution    = entity.restitution;

    body.isSensor       = entity.is_sensor;
    
    // The Matter.js API does not notice if an object woke up due to velocity, only
    // due to forces.
    awake = awake || $Math.max($Math.abs(body.angularVelocity), $Math.abs(body.velocity.x), $Math.abs(body.velocity.y)) > 0.01;
    // $Math.max($Math.abs(body.torque), $Math.abs(body.force.x), $Math.abs(body.force.y)) > 1e-9 ||
    
    // Change wake state if needed
    if (body.isSleeping === awake) {
        $Physics.Sleeping.set(body, ! awake);
    }
}

      
function physics_simulate(physics, stepFrames) {
    physics.$inSimulate = true;
    const startTime = $performance.now();
    
    if (stepFrames === undefined) { stepFrames = 1; }
    const engine = physics.$engine;

    // $console.log('--------------- timestamp: ' + physics.timing.timestamp);

    // Apply custom attachment forces
    for (let a = 0; a < engine.customAttachments.length; ++a) {
        const attachment = engine.customAttachments[a];
        if (attachment.type === 'torsion_spring') {
            const angle = attachment.angle;
            const entityA = attachment.entityA;
            const entityB = attachment.entityB;
            
            // Hook's law
            const delta = loop(angle + (entityA ? entityA.angle : 0) - entityB.angle, -$Math.PI, $Math.PI);
            let torque = 5000 * delta * attachment.stiffness;
            
            // Note that linear damping applies to all velocity in matter.js, not to
            // spring force itself. However, this is hard to stabilize for
            // a torque because if we just affect angular velocity it will
            // not be around the point in question and causes problems.
            //
            // https://github.com/liabru/matter-js/blob/master/src/constraint/Constraint.js#L221

            const relativeVel = entityB.spin - (entityA ? entityA.spin : 0);
            if ($Math.sign(relativeVel) === $Math.sign(torque)) {
                // Damp when already spinning in the torque direction
                torque /= 1 + 1000 * $Math.abs(relativeVel) * attachment.damping;
            }
            
            if (entityA) { entityA.torque -= torque; }
            entityB.torque += torque;
        } // if torsion_spring
    } // for a
     
    physics.$newContactArray = [];

    const bodies = $Physics.Composite.allBodies(engine.world);
    for (let b = 0; b < bodies.length; ++b) {
        const body = bodies[b];
        // Not all bodies have entities; some are created
        // internally by the physics system.
        if (body.entity) { $bodyUpdateFromEntity(body); }
    }
        
    $Physics.Engine.update(engine, stepFrames * 1000 / 60);
    
    // Enforce custom attachment constraints. This would be better
    // implemented by injecting the new constraint solver directly
    // into $Physics.Constraint.solveAll, so that it happens within
    // the solver during the main iterations. However, that requires
    // modifying the core of the physics engine and makes it harder
    // to upgrade. matter.js has promised to add hinge joints circa 2022
    // and those would allow enforcing these automatically.
    if (engine.customAttachments.length > 0) {
        // Two iterations
        for (let it = 0; it < 2; ++it) {
            for (let a = 0; a < engine.customAttachments.length; ++a) {
                const attachment = engine.customAttachments[a];
                if (attachment.type === 'gyro') {
                    const body = attachment.entityB.$body;
                    const angle = attachment.angle;
                    $Physics.Body.setAngularVelocity(body, 0);
                    $Physics.Body.setAngle(body, angle);
                }  // if gyro
            } // for iteration
            
            // Force one extra iteration of constraint solving to reconcile
            // what we just did above, so that attached parts are not lagged
            if (it === 0) {
                let allConstraints = $Physics.Composite.allConstraints(engine.world);
                
                $Physics.Constraint.preSolveAll(bodies);
                for (let i = 0; i < engine.constraintIterations; ++i) {
                    $Physics.Constraint.solveAll(allConstraints, engine.timing.timeScale);
                }
                $Physics.Constraint.postSolveAll(bodies);
            }
        }
    }
   
    for (let b = 0; b < bodies.length; ++b) {
        const body = bodies[b];
        // Some bodies are created internally within the physics system
        // and have no corresponding entity.
        if (body.entity) { $entityUpdateFromBody(body.entity); }
    }

    // Remove old contacts that were never reestablished.
    // Advance the contact queue
    const maybeBrokenContactList = physics.$brokenContactQueue.shift(1);
    physics.$brokenContactQueue.push([]);
    
    for (let c = 0; c < maybeBrokenContactList.length; ++c) {
        const contact = maybeBrokenContactList[c];
        // See if contact was reestablished within the lifetime of the queue:
        if (contact.$lastRealContactFrame <= physics.$frame - physics.$brokenContactQueue.length) {
            // Contact was not reestablished in time, so remove it
            const bodyA = contact.entityA.$body, bodyB = contact.entityB.$body;

            // For debugging collisions:
            // $console.log(physics.$frame + ' - end  ' + contact.entityA.name + " & " + contact.entityB.name + '\n\n');

            // Remove the contact both ways
            const mapA = physics.$entityContactMap.get(bodyA);
            if (mapA) { mapA.delete(bodyB); }
            
            const mapB = physics.$entityContactMap.get(bodyB);
            if (mapB) { mapB.delete(bodyA); }
        }
    }

    if ($showPhysicsEnabled) {
        draw_physics(physics);
    }

    // Fire event handlers for new contacts
    for (const callback of physics.$contactCallbackArray.values()) {
        for (const contact of physics.$newContactArray.values()) {
            if (((contact.entityA.contact_category_mask | contact.entityB.contact_category_mask) & callback.contact_mask) &&
                (contact.depth >= callback.min_depth) &&
                (contact.depth <= callback.max_depth) &&
                ((callback.sensors === 'include') ||
                 ((callback.sensors === 'only') && (contact.entityA.is_sensor || contact.entityB.is_sensor)) ||
                 ((callback.sensors === 'exclude') && ! (contact.entityA.is_sensor || contact.entityB.is_sensor)))) {
                
                callback.callback({
                    entityA: contact.entityA,
                    entityB: contact.entityB,
                    normal:  xy(contact.normal),
                    depth:   contact.depth,
                    point0:  xy(contact.point0),
                    point1:  contact.point1 ? xy(contact.point1) : undefined,
                });
            }
        } // event
    } // contact

    physics.$inSimulate = false;
    ++physics.$frame;

    for (let i = 0; i < physics.$removeEntityArray.length; ++i) {
        physics_remove_entity(physics, physics.$removeEntityArray[i]);
    }
    physics.$removeEntityArray.length = 0;

    const endTime = $performance.now();
    $physicsTimeTotal += endTime - startTime;
}


function physics_add_contact_callback(physics, callback, min_depth, max_depth, contact_mask, sensors) {
    if (contact_mask === 0) { $error('A contact callback with contact_mask = 0 will never run.'); }

    physics.$contactCallbackArray.push({
        callback:      callback,
        min_depth:     min_depth || 0,
        max_depth:     (max_depth !== undefined) ? max_depth : Infinity,
        contact_mask:  (contact_mask !== undefined) ? contact_mask : 0xffffffff,
        sensors:       sensors || 'exclude'
    });
}


function physics_entity_has_contacts(physics, entity, region, normal, mask, sensors) {
    return $physics_entity_contacts(physics, entity, region, normal, mask, sensors, true);
}


function physics_entity_contacts(physics, entity, region, normal, mask, sensors) {
    return $physics_entity_contacts(physics, entity, region, normal, mask, sensors, false);
}


function $physics_entity_contacts(physics, entity, region, normal, mask, sensors, earlyOut) {
    if (mask === undefined) { mask = 0xffffffff; }
    if (mask === 0) { $error('physics_entity_contacts() with mask = 0 will never return anything.'); }
    if (! entity) { $error('physics_entity_contacts() must have a non-nil entity'); }

    const engine = physics.$engine;
    sensors = sensors || 'exclude';

    // Look at all contacts for this entity
    const body = entity.$body;
    const map = physics.$entityContactMap.get(body);
    const result = earlyOut ? false : [];

    if (map === undefined) {
        // No contacts
        return result;
    }
    
    // Create a test shape with all of the required properties to avoid allocation by the
    // repeated overlaps() calls
    const testPointShape = {shape: 'disk', angle: 0, size: xy(0, 0), scale: xy(1, 1), pos: xy(0, 0)};
    const testPoint = testPointShape.pos;

    const Rx = $Math.cos(entity.angle) / entity.scale.x, Ry = $Math.sin(entity.angle) * rotation_sign() / entity.scale.y;
    const Tx = entity.pos.x, Ty = entity.pos.y;

    // Avoid having overlaps() perform the cleanup test many times
    if (region) { region = $cleanupRegion(region); }
    if (normal) { normal = direction(normal); }
    
    // cosine of 75 degrees
    const angleThreshold = $Math.cos($Math.PI * 80 / 180);
    
    for (const contact of map.values()) {
        const isA = contact.entityA === entity;
        const isB = contact.entityB === entity;
        const other = isA ? contact.entityB : contact.entityA; 

        // Are we in the right category?
        if ((other.contact_category_mask & mask) === 0) {
            // $console.log("Mask rejection");
            continue;
        }

        if (((sensors === 'exclude') && other.is_sensor) ||
            ((sensors === 'only') && ! other.is_sensor)) {
            // $console.log("Sensor rejection");
            continue;
        }
 

        if (region) {
            let x, y;
            if (contact.point1) {
                x = (contact.point0.x + contact.point1.x) * 0.5;
                y = (contact.point0.y + contact.point1.y) * 0.5;
            } else {
                x = contact.point0.x; y = contact.point0.y;
            }

            x -= Tx; y -= Ty;
            
            // Transform the average point to the reference frame of
            // the region.  This will make testing faster for the
            // common case of an axis-aligned box.
            testPoint.x = Rx * x + Ry * y;
            testPoint.y = Rx * y - Ry * x;
            
            // Is the average contact point within the region?
            if (! overlaps(region, testPointShape, false)) {
                // $console.log("Region rejection");
                continue;
            }
        }

        if (normal) {
            // Collision normal
            let Cx = contact.normal.x, Cy = contact.normal.y;
            if (isB) { Cx = -Cx; Cy = -Cy; }
            if (Cx * normal.x + Cy * normal.y < angleThreshold) {
                // $console.log("Angle rejection");
                continue;
            }
        }

        if (earlyOut) { return true; }
        
        // Push a copy of the contact. Do not deep clone,
        // as that would copy the entitys as well.
        $console.assert(contact.normal && contact.point0);
        const copy = {
            entityA: contact.entityA,
            entityB: contact.entityB,
            normal:  xy(contact.normal),
            point0:  xy(contact.point0),
            depth:   contact.depth
        };
        if (contact.point1) { copy.point1 = {x:contact.point1.x, y:contact.point1.y}; }
        result.push(copy);
    }

    return result;
}


function physics_detach(physics, attachment) {
    // Remove from the entitys
    fast_remove_value(attachment.entityB.$attachmentArray, attachment);
    if (attachment.entityA) { fast_remove_value(attachment.entityA.$attachmentArray, attachment); }

    // Decrement and remove reference-counted no-collision elements
    const mapA = attachment.entityA.$body.collisionFilter.excludedBodies;
    if (mapA) {
        const count = mapA.get(attachment.entityB.$body);
        if (count !== undefined) {
            if (count > 1) {
                mapA.set(attachment.entityB.$body, count - 1);
            } else {
                // Remove the no-collision condition
                mapA.delete(attachment.entityB.$body);
            }
        }
    }

    const mapB = attachment.entityB.$body.collisionFilter.excludedBodies;
    if (mapB) {
        const count = mapB.get(attachment.entityA.$body);
        if (count !== undefined) {
            if (count > 1) {
                mapB.set(attachment.entityA.$body, count - 1);
            } else {
                // Remove the no-collision condition
                mapB.delete(attachment.entityA.$body);
            }
        }
    }

    // Remove the composite, which will destroy all of the Matter.js elements
    // that comprise this constraint
    $Physics.Composite.remove(physics.$engine.world, attachment.$composite, true);

    if (attachment.type === 'gyro' || attachment.type === 'torsion_spring') {
        fast_remove_value(physics.customAttachments, attachment);
    }
}


function physics_attach(physics, type, param) {
    if (param.entityA && ! param.entityA.$body) { $error('entityA has not been added to the physics context'); }
    if (! param.entityB) { $error('entityB must not be nil'); }
    if (! param.entityB.$body) { $error('entityB has not been added to the physics context'); }
    if (param.entityB.density === Infinity) { $error('entityB must have finite density'); }

    physics = physics.$engine;

    // Object that will be returned
    const attachment = {
        type:    type,
        entityA: param.entityA,
        entityB: param.entityB
    };

    const wsB = transform_es_to_ws(param.entityB, param.pointB || xy(0, 0));
    
    if (type === 'weld') {
        // Satisfy the initial angle constraint. Do this before computing
        // positions
        if (param.length !== undefined) { $error('Weld attachments do not accept a length parameter'); }
        if (param.angle !== undefined) {
            param.entityB.angle = param.angle + (param.entityA ? param.entityA.angle : 0);
            $bodyUpdateFromEntity(attachment.entityB.$body);
        }
    }
    
    // Create options for constructing a matter.js constraint.
    // matter.js wants the points relative to the centers of the
    // bodies, but not rotated by the bodies
    const options = {
        bodyB:  param.entityB.$body,
        pointB: $objectSub(wsB, param.entityB.pos)
    };

    if (type === 'weld') {
        // Use this hack to stiffen; setting angularStiffness very high
        // is likely to affect torque in strange ways, so don't go too high
        options.angularStiffness = 0.1;
    }
    
    /////////////////////////////////////////////////////////////////////
    // Are collisions allowed between these objects? By default,
    // welds, pins, and torsion springs prevent collisions.
    
    let collide = find(['rope', 'string', 'rod'], type) !== undefined;
    if (param.collide !== undefined) { collide = param.collide; }
    
    // Always enable collisions with the world, since they won't happen
    // and it is free to do so
    if (! param.entityA) { collide = true; }

    if (param.entityA &&
        (param.entityA.$body.collisionFilter.group < 0) &&
        (param.entityA.$body.collisionFilter.group === param.entityB.$body.collisionFilter.group)) {
        // These are in the same collision group; they couldn't collide anyway, so there is no
        // need to explicitly prevent collisions
        collide = true;
    }

    if (param.entityA &&
        ((param.entityB.$body.collisionFilter.mask & param.entityA.$body.collisionFilter.category) === 0) &&
        ((param.entityA.$body.collisionFilter.mask & param.entityB.$body.collisionFilter.category) === 0)) {
        // These could not collide with each other because they have no overlap in their masks
        collide = true;
    }

    // Update the entity's collision filters. See console/matter-extensions.js
    if (! collide) {
        // Reference counting on the excludedBodies maps
        param.entityA.$body.collisionFilter.body = param.entityA.$body;
        if (! param.entityA.$body.collisionFilter.excludedBodies) { param.entityA.$body.collisionFilter.excludedBodies = new WeakMap(); }
        param.entityA.$body.collisionFilter.excludedBodies.set(param.entityB.$body, (param.entityA.$body.collisionFilter.excludedBodies.get(param.entityB.$body) || 0) + 1);

        param.entityB.$body.collisionFilter.body = param.entityB.$body;
        if (! param.entityB.$body.collisionFilter.excludedBodies) { param.entityB.$body.collisionFilter.excludedBodies = new WeakMap(); }        
        param.entityB.$body.collisionFilter.excludedBodies.set(param.entityA.$body, (param.entityB.$body.collisionFilter.excludedBodies.get(param.entityA.$body) || 0) + 1);
    }

    /////////////////////////////////////////////////////////////////////

    // World-space attachment points
    let wsA;
    if (param.entityA) {
        options.bodyA = param.entityA.$body;
        if (param.pointA) {
            wsA = transform_es_to_ws(param.entityA, param.pointA);
        } else {
            wsA = wsB;
        }
    } else if (param.pointA) {
        // no entityA but there is a pointA, treat it as
        // in world space because we're attaching to the world
        wsA = param.pointA;
    } else {
        // Default to the same point on the world
        wsA = wsB;
    }
    options.pointA = param.entityA ? 
        $objectSub(wsA, param.entityA.pos) :
        wsA;

    const delta = $objectSub(wsB, wsA);
    const len = magnitude(delta);
   
    switch (type) {
    case 'gyro':
        {
            attachment.angle = (param.angle === undefined) ? loop(param.entityB.angle, -$Math.PI, $Math.PI) : 0;
            // We *could* make this work against an arbitrary entity, but for now
            // constrain to the world for simplicity
            if (param.entityA) { $error('A "gyro" attachment requires that entityA = nil'); }
            push(physics.customAttachments, attachment);
        }
        break;
        
    case 'spring':
    case 'rod':
    case 'weld':
        {
            if (type === 'spring') {
                options.damping = (param.damping !== undefined) ? param.damping : 0.002;
                options.stiffness = (param.stiffness !== undefined) ? param.stiffness : 0.005;
            } else {
                // For stability, don't make the joints too stiff
                options.damping   = 0.2;
                options.stiffness = 0.95;
            }
            
            attachment.damping = options.damping;
            attachment.stiffness = options.stiffness;
            if ((param.length === undefined) && (type !== 'weld')) {
                // Default to the current positions for springs and rods
                attachment.length = len;
            } else {
                attachment.length = (type === 'weld') ? 0 : param.length;

                // Amount positions need to change by to satisfy the
                // rest length initially. matter.js uses the current
                // positions of the bodies to determine the rest length
                const change = attachment.length - len;
                
                if ($Math.abs(change) > 1e-9) {
                    // Teleport entityB to satisfy the rest length
                    if (len <= 1e-9) {
                        // If A and B are on top of each other and there's
                        // a nonzero rest length, arbitrarily choose to
                        // move along the x-axis
                        attachment.entityB.pos.x += change;
                    } else{
                        attachment.entityB.pos.x += delta.x * change / len;
                        attachment.entityB.pos.y += delta.y * change / len;
                    }
                    $bodyUpdateFromEntity(attachment.entityB.$body);
                }
            }

            attachment.$composite = $Physics.Composite.create();
            const constraint = $Physics.Constraint.create(options);
            constraint.attachment = attachment;
            $Physics.Composite.add(attachment.$composite, constraint);
            
            if (attachment.type === 'weld') {
                if (! param.entityA) { $error('Entities may not be welded to the world. Use infinite density instead.'); }

                // Connect back with double-constraints to go through
                // an intermediate "weld body" object.  The weld body
                // must be centered at the constraint point so that
                // its rotation is ignored.  Make the weld body a disk
                // so that rotation has no net effect on shape (and
                // thus moment of inertia) as well as it spins.
                //
                // Only one weld body is required to prevent roation,
                // but that body must be away from the weld center and
                // thus will create asymmetry. A full circle of pins
                // would be the most symmetric, but is expensive, so
                // we add a small number of weld bodies.
                //
                // Each fake body must have some mass to it or the
                // constraints won't have much effect. Unfortunately,
                // this changes the net mass and moment of inertia of
                // the compound shape, which is why parenting is a
                // better solution than welding.

                // Higher gives more rigidity but also affects moment
                // of inertia more
                const offsetRadius = 16;
                const numPins = 4;
                const weldPinRadius = 3;

                let mA = entity_mass(param.entityA);
                let mB = entity_mass(param.entityB);
                
                // Handle the case where one object has infinite mass
                if (mA === Infinity) { mA = mB; }
                if (mB === Infinity) { mB = mA; }
                
                // Handle the case where both were infinite (welds should
                // not be allowed in this case)
                if (mA === Infinity) { mA = mB = 5; }
                    
                // Higher weld density gives more rigidity but also affects mass
                // and moment of inertia more.
                const weldDensity = $PHYSICS_MASS_SCALE * $Math.max(mA + mB, 1) / 3500;

                // In world space
                const weldPos = $objectAdd(options.pointB, param.entityB.$body.position);
                const weldDamping = 0.2;
                
                // Iterate around the circle
                for (let p = 0; p < numPins; ++p) {
                    const offsetAngle = 2 * $Math.PI * p / numPins;
                    const offset = xy(offsetRadius * $Math.cos(offsetAngle), offsetRadius * $Math.sin(offsetAngle));

                    const weldBody = $Physics.Bodies.circle(weldPos.x + offset.x, weldPos.y + offset.y, weldPinRadius, {density: weldDensity});
                    // Prevent collisions with everything
                    weldBody.collisionFilter.mask = weldBody.collisionFilter.category = 0;
                    // Add the invisible weldBody
                    $Physics.Composite.add(attachment.$composite, weldBody);

                    // B -> Weld
                    $Physics.Composite.add(attachment.$composite, $Physics.Constraint.create({
                        bodyA:     param.entityB.$body,
                        pointA:    $objectSub(weldBody.position, param.entityB.$body.position),
                        bodyB:     weldBody,
                        damping:   weldDamping,
                        stiffness: 0.9
                    }));
                    
                    // Weld -> A
                    $Physics.Composite.add(attachment.$composite, $Physics.Constraint.create({
                        bodyA:     weldBody,
                        bodyB:     param.entityA.$body, 
                        pointB:    $objectSub(weldBody.position, param.entityA.$body.position),
                        damping:   weldDamping,
                        stiffness: 0.9
                    }));

                } // for each weld pin
            }
            
        }
        break;
      
    case 'torsion_spring':
        attachment.angle = loop((param.angle === undefined) ?
                                param.entityB.angle - (param.entityA ? param.entityA.angle : 0) : 0, -$Math.PI, $Math.PI);
        attachment.damping = (options.damping !== undefined ? options.damping : 0.002);
        attachment.stiffness = (options.stiffness !== undefined ? options.stiffness : 0.005);
        // intentionally fall through
        
    case 'pin':
        {
            if ($Math.abs(len) > 1e-9) {
                attachment.entityB.pos.x -= delta.x;
                attachment.entityB.pos.y -= delta.y;
                $bodyUpdateFromEntity(attachment.entityB.$body);
            }

            // matter.js uses the current positions of the bodies to determine the rest length
            attachment.$composite = $Physics.Composite.create();
            const constraint = $Physics.Constraint.create(options);
            constraint.attachment = attachment;
            $Physics.Composite.add(attachment.$composite, constraint);
            push(physics.customAttachments, attachment);
        }
        break;
        
    default:
        $error('Attachment type "' + type + '" not supported');
    }

    
    if (attachment.$composite) {
        // Push the attachment's composite into the world
        $Physics.Composite.add(physics.world, attachment.$composite);
    }

    if (attachment.entityA) { push(attachment.entityA.$attachmentArray, attachment); }
    push(attachment.entityB.$attachmentArray, attachment);
    
    return Object.freeze(attachment);
}
      
      
function draw_physics(physics) {
    const showSecrets = false;
    const awakeColor   = rgb(0.10, 1.0, 0.5);
    const sleepColor   = rgb(0.05, 0.6, 0.3);
    const staticColor  = gray(0.8);
    const contactColor = rgb(1, 0.93, 0);
    const sensorColor      = rgb(0.3, 0.7, 1);
    const newContactColor = rgb(1, 0, 0);
    const constraintColor = rgb(0.7, 0.5, 1);
    const secretColor  = rgb(1, 0, 0);
    const zOffset = 0.01;

    const engine       = physics.$engine;
    
    const bodies = $Physics.Composite.allBodies(engine.world);
    for (let b = 0; b < bodies.length; ++b) {
        const body = bodies[b];
        if (! body.entity && ! showSecrets) { continue; }

        const color =
              (! body.entity ? secretColor :
               (body.isSensor ? sensorColor:
                (body.isStatic ? staticColor :
                 (body.isSleeping ? sleepColor :
                  awakeColor))));
        
        const z = body.entity ? body.entity.z + zOffset : 100;
        for (let p = 0; p < body.parts.length; ++p) {
            const part = body.parts[p];
            const C = $Math.cos(part.angle);
            const S = $Math.sin(part.angle);

            let r = 4;
            if (body.circleRadius) {
                draw_disk(part.position, part.circleRadius, undefined, color, z);
                r = $Math.min(r, part.circleRadius - 2);
            } else {
                const V = part.vertices[0];
                draw_line(last_value(part.vertices), V, color, z);
                let maxR2 = magnitude_squared(V.x - part.position.x, V.y - part.position.y);
                for (let i = 1; i < part.vertices.length; ++i) {
                    const V = part.vertices[i];
                    maxR2 = $Math.max(magnitude_squared(V.x - part.position.x, V.y - part.position.y), maxR2);
                    draw_line(part.vertices[i - 1], V, color, z);
                }
                r = $Math.min($Math.sqrt(maxR2) - 2, r);
            }
            
            // Axes
            const axis = xy(r * C, r * S);
            draw_line($objectSub(part.position, axis), $objectAdd(part.position, axis), color, z);
            let temp = axis.x; axis.x = -axis.y; axis.y = temp;
            draw_line($objectSub(part.position, axis), $objectAdd(part.position, axis), color, z);
        }
    } // bodies

    const weldTri = [xy(0, 5), xy(4.330127018922194, -2.5), xy(-4.330127018922194, -2.5)];
    const constraints = $Physics.Composite.allConstraints(engine.world);
    for (let c = 0; c < constraints.length; ++c) {
        const constraint = constraints[c];
        const attachment = constraint.attachment;

        // Not a renderable constraint
        if (! attachment && ! showSecrets) { continue; }
        
        const type = attachment ? attachment.type : '';

        let pointA = constraint.pointA;
        let pointB = constraint.pointB;
        let zA = -Infinity, zB = -Infinity;
        
        if (constraint.bodyA) {
            pointA = $objectAdd(pointA, constraint.bodyA.position);
            zA = attachment ? constraint.bodyA.entity.z : 100;
        }
        
        if (constraint.bodyB) {
            pointB = $objectAdd(pointB, constraint.bodyB.position);
            zB = attachment ? constraint.bodyB.entity.z : 100;
        }
        const z = $Math.max(zA, zB) + zOffset;

        const color = attachment ? constraintColor : secretColor;

        // Line part
        if (type === 'spring') {
            // Choose the number of bends based on the rest length,
            // and then stretch
            const longAxis = $objectSub(pointB, pointA);
            const crossAxis = $objectMul(xy(-longAxis.y, longAxis.x),
                                         $clamp(8 - $Math.pow(constraint.stiffness, 0.1) * 8, 1, 7) / magnitude(longAxis));
            const numBends = $Math.ceil(attachment.length / 2.5);
            let prev = pointA;
            for (let i = 1; i < numBends; ++i) {
                const end = (i === 1 || i === numBends - 1);
                const u = (end ? i + 0.5 : i) / numBends;
                const v = end ? 0 : (2 * (i & 1) - 1);
                const curr = $objectAdd(pointA,
                                        $objectAdd($objectMul(longAxis, u),
                                                   $objectMul(crossAxis, v))); 
                draw_line(prev, curr, color, z);
                prev = curr;
            }
            draw_line(prev, pointB, color, z);
        } else {
            // Line between the two points for a rod, rope, or other
            // constraint where the points may be separated
            draw_line(pointA, pointB, color, z);
        }
        
        if (type === 'weld') {
            // Show a triangle to indicate that this attachment is rigid
            draw_poly(weldTri, color, undefined, pointB, constraint.bodyB.angle, undefined, z);
        } else if (type === 'pin') {
            // Show one disk
            draw_disk(pointA, 3, color, undefined, z);
        } else if (type === 'torsion_spring') {
            // Show the coils
            draw_disk(pointA, 1, undefined, color, z);
            draw_disk(pointA, 3, undefined, color, z);
            draw_disk(pointA, 4, undefined, color, z);            
        } else {
            // Show the two disks
            draw_disk(pointA, 3, undefined, color, z);
            draw_disk(pointB, 2.5, color, undefined, z);
        }
    }

    // For contacts, do not iterate over physics.pairs.list, as that
    // is the potentially O(n^2) cache of all pairs ever created and
    // most of them may not be active.

    const contactBox = xy(3, 3);
    for (const [body0, map] of physics.$entityContactMap) {
        for (const [body1, contact] of map) {
            // Draw each only once, for the body with the lower ID
            if (body0.id < body1.id) {
                const z = $Math.max(contact.entityA.z, contact.entityB.z) + zOffset;
                draw_rect(contact.point0, contactBox, contactColor, undefined, 0, z);
                if (contact.point1) { draw_rect(contact.point1, contactBox, contactColor, undefined, 0, z); }
            }
        }
    }

    const newContactBox = xy(7, 7);
    for (let c = 0; c < physics.$newContactArray.length; ++c) {
        const contact = physics.$newContactArray[c];
        const z = $Math.max(contact.entityA.z, contact.entityB.z) + zOffset;

        // Size based on penetration
        newContactBox.x = newContactBox.y = $clamp(1 + contact.depth * 2, 1, 10);
        
        draw_rect(contact.point0, newContactBox, newContactColor, undefined, 0, z);
        if (contact.point1) { draw_rect(contact.point1, newContactBox, newContactColor, undefined, 0, z); }
    }
}
