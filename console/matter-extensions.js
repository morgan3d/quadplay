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

// Override
Matter.Pair.update = 
(function (superMethod) {
    return function(pair, collision, timestamp) {
        // Call parent version
        superMethod(pair, collision, timestamp);

        var parentA = collision.parentA,
            parentB = collision.parentB;
        
        pair.friction = Math.sqrt(parentA.friction * parentB.friction);
        pair.restitution = Math.sqrt(parentA.restitution * parentB.restitution);
        
    };
})(Matter.Pair.update);

