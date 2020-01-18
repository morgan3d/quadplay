/* Extensions to matter.js added for quadplay */

// Extend collisionFilter so that it may contain a 'body' field and
// may contain an 'excludedBodies' WeakMap of bodies. If present,
// collision lists are checked both ways to determine if the objects
// can collide with each other. Either filter can exclude the other.
// Note that undefined > 0 is false, so an element that is either not
// present or has a count that is zero will not exclude the collision

Matter.Detector.canCollide = function(filterA, filterB) {
    if ((filterA.group === filterB.group) && (filterA.group !== 0)) {
        return filterA.group > 0;
    } else if ((filterA.mask & filterB.category) !== 0 && (filterB.mask & filterA.category) !== 0) {
        return ! (filterA.body &&
                  filterB.body && 
                  ((filterA.excludedBodies && filterA.excludedBodies.get(filterB.body) > 0) ||
                   (filterB.excludedBodies && filterB.excludedBodies.get(filterA.body) > 0)));
    }
    
    return false;
};



// Extend Pair to use the geometric mean of friction and restitution
// coefficients, which tends to make them more tunable.

Matter.Pair.update = function(pair, collision, timestamp) {
    pair.collision = collision;
    
    if (collision.collided) {
        var supports = collision.supports,
            activeContacts = pair.activeContacts,
            parentA = collision.parentA,
            parentB = collision.parentB;
        
        pair.inverseMass = parentA.inverseMass + parentB.inverseMass;
        pair.friction = Math.sqrt(parentA.friction * parentB.friction); // Changed
        pair.frictionStatic = Math.max(parentA.frictionStatic, parentB.frictionStatic);
        pair.restitution = Math.sqrt(parentA.restitution * parentB.restitution); // Changed
        pair.slop = Math.max(parentA.slop, parentB.slop);
        
        for (var i = 0; i < supports.length; i++) {
            activeContacts[i] = supports[i].contact;
        }
        
        // optimise array size
        var supportCount = supports.length;
        if (supportCount < activeContacts.length) {
            activeContacts.length = supportCount;
        }
        
        pair.separation = collision.depth;
        Matter.Pair.setActive(pair, true, timestamp);
    } else {
        if (pair.isActive === true)
            Pair.setActive(pair, false, timestamp);
    }
};
