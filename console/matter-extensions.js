/* Extensions to matter.js added for quadplay */

// Extend collisionFilter so that it may contain a 'body' field and
// may contain an 'excludedBodies' array of bodies. If present,
// collision lists are checked both ways to determine if the objects
// can collide with each other. Either filter can exclude the other.

Matter.Detector.canCollide = function(filterA, filterB) {
    if ((filterA.group === filterB.group) && (filterA.group !== 0)) {
        return filterA.group > 0;
    } else if ((filterA.mask & filterB.category) !== 0 && (filterB.mask & filterA.category) !== 0) {
        return ! (filterA.body &&
                  filterB.body && 
                  ((filterA.excludedBodies && filterA.excludedBodies.length && (filterA.excludedBodies.indexOf(filterB.body) !== -1)) ||
                   (filterB.excludedBodies && filterB.excludedBodies.length && (filterB.excludedBodies.indexOf(filterA.body) !== -1))));
    }
    
    return false;
};

