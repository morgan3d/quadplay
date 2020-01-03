Upcoming quadplay physics system changes, in priority order:

- add sensors to API

- Collision exclusion array reference counts for automatically-added exclusions,
  so that they can be automatically removed properly

- Document pivots and then either explicitly disallow them in applyForce and applyImpulse
  or implement them.

