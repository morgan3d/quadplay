/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */

// Variables named with a leading underscore are illegal in nano and
// will therefore not be visible to the program.
'use strict';

var _gameMode = undefined, _prevMode = undefined;
var _showBootAnimation = true;

// Modes from popMode. Does not contain _gameMode
var _modeStack = [], _prevModeStack = [];

// Overriden by setFramebufferSize()
var _SCREEN_WIDTH = 384, _SCREEN_HEIGHT = 224;

var _Math = Math;
var _previousModeGraphicsCommandList = [];

// Does not contain _previousModeGraphicsCommandList
var _previousModeGraphicsCommandListStack = [];
var _frameHooks = [];

var gameFrames = 0;
var modeFrames = 0;

// Graphics execute once out of this many frames.  Must be 1 (60 Hz),
// 2 (30 Hz), 3 (20 Hz), or 4 (15 Hz). This is managed by
// quadplay-ide.js. Note that game logic always executes at 60 Hz.
var _graphicsPeriod = 1;

// Time spent in graphics the last time that it executed.
var _graphicsTime = 0;

// Only used on Safari
var _currentLineNumber = 0;

var _modeFramesStack = [];

var _postFX;

var isNaN = Number.isNaN;

function resetPostEffects() {
    _postFX = {
        background: {r:0, g:0, b:0, a:0},
        color: {r:0, g:0, b:0, a:0},
        blendMode: "source-over",
        pixelate: 0,
        scale: {x: 1, y: 1},
        angle: 0,
        pos: {x:0, y:0},
        opacity: 1
    };
}

resetPostEffects();


function setPostEffects(args) {
    if (args.background !== undefined) {
        _postFX.background.r = (args.background.r !== undefined) ? args.background.r : 0;
        _postFX.background.g = (args.background.g !== undefined) ? args.background.g : 0;
        _postFX.background.b = (args.background.b !== undefined) ? args.background.b : 0;
        _postFX.background.a = (args.background.a !== undefined) ? args.background.a : 1;
    }

    if (args.color !== undefined) {
        _postFX.color.r = (args.color.r !== undefined) ? args.color.r : 0;
        _postFX.color.g = (args.color.g !== undefined) ? args.color.g : 0;
        _postFX.color.b = (args.color.b !== undefined) ? args.color.b : 0;
        _postFX.color.a = (args.color.a !== undefined) ? args.color.a : 1;
    }

    switch (args.blendMode) {
    case undefined: break;
    case 'source-over':
    case 'hue':
    case 'multiply':
    case 'difference':
        _postFX.blendMode = args.blendMode;
        break;
    default: throw new Error('Illegal blendMode for post effects: "' + args.blendMode + '"');
    }

    if (args.scale !== undefined) {
        _postFX.scale.x = (args.scale.x !== undefined) ? args.scale.x : 1;
        _postFX.scale.y = (args.scale.y !== undefined) ? args.scale.y : 1;
    }

    if (args.angle !== undefined) {
        _postFX.angle = args.angle;
    }

    if (args.pos !== undefined) {
        _postFX.pos.x = (args.pos.x !== undefined) ? args.pos.x : SCREEN_WIDTH / 2;
        _postFX.pos.y = (args.pos.y !== undefined) ? args.pos.y : SCREEN_HEIGHT / 2;
    }
    
    if (args.opacity !== undefined) {
        _postFX.opacity = args.opacity;
    }
}


function addFrameHook(callback, endCallback, lifetime, mode) {
    if (arguments.length < 4) { mode = getMode(); }
    const hook = {_callback:callback, _endCallback:endCallback, _mode:mode, _lifetime:lifetime, _maxLifetime:lifetime};
    _frameHooks.push(hook);
    return hook;
}


function removeFrameHook(hook) {
    removeValues(_frameHooks, hook);
}


function removeFrameHooksByMode(mode) {
    for (let i = 0; i < _frameHooks.length; ++i) {
        if (_frameHooks[i]._mode === mode) {
            _frameHooks[i] = _frameHooks[_frameHooks.length - 1];
            --i;
            --_frameHooks.length;
        }
    }
}


function _processFrameHooks() {
    for (let i = 0; i < _frameHooks.length; ++i) {
        const hook = _frameHooks[i];
        if ((hook._mode === undefined) || (hook._mode === _gameMode)) {
            --hook._lifetime;
            const r = hook._callback ? hook._callback(hook._lifetime, hook._maxLifetime) : 0;

            // Remove the callback *before* it executes so that if
            // a setMode happens within the callback it does not re-trigger
            if (r || (hook._lifetime <= 0)) {
                _frameHooks[i] = _frameHooks[_frameHooks.length - 1];
                --i;
                --_frameHooks.length;
            }
            
            if (! r && (hook._lifetime <= 0)) {
                // End hook
                if (hook._endCallback) { hook._endCallback(); }
            }

        }
    }        
}


function drawPreviousMode() {
    Array.prototype.push.apply(_graphicsCommandList, _previousModeGraphicsCommandList);
}

////////////////////////////////////////////////////////////////////
// Array

function find(a, x, s) {
    s = s || 0;
    if (Array.isArray(a)) {
        const L = a.length;
        for (let i = s; i < L; ++i) {
            if (a[i] === x) { return i; }
        }
        return undefined;
    } else if (typeof a === 'string') {
        let i = a.indexOf(x, s);
        return (i === -1) ? undefined : i;
    } else {
        for (let k in a) {
            if (a[k] === x) { return k; }
        }
        return undefined;
    }
}


function push(array, ...args) {
    if (! Array.isArray(array)) { throw new Error('push() requires an array argument'); }
    array.push(...args);
}


function pushFront(array, ...args) {
    if (! Array.isArray(array)) { throw new Error('pushFront() requires an array argument'); }
    array.unshift(...args);
}


function popFront(array) {
    if (! Array.isArray(array)) { throw new Error('popFront() requires an array argument'); }
    if (array.length === 0) { return undefined;  }
    return array.shift();
}


function pop(array) {
    return array.pop();
}


function _defaultComparator(a, b) {
    return (a < b) ? -1 : (a > b) ? 1 : 0;
}


function sort(array, k) {
    let compare;
    
    if (k === undefined) {
        if (typeof array[0] === 'object') {
            // Find the first property, alphabetically
            const keys = Object.keys();
            keys.sort();
            k = keys[0];
            compare = function (a, b) { return _defaultComparator(a[k], b[k]); };
        } else {
            // Just use the default comparator
            compare = _defaultComparator;
        }
    } else if (typeof compare !== 'function') {
        // sort by index or key k
        compare = function (a, b) { return _defaultComparator(a[k], b[k]); };
    }

    array.sort(compare);
}


function resize(a, n) {
    a.length = n;
}

/////////////////////////////////////////////////////////////////////
//
// Table and Array

function size(x) {
    if (Array.isArray(x)) {
        return x.length;
    } else {
        let tx = typeof x;
        if (tx === 'string') {
            return x.length;
        } else if (tx === 'object') {
            return Object.keys(this).length;
        } else {
            return 0;
        }
    }
}


function rndValue(t) {
    const T = typeof t;
    if (Array.isArray(t) || (T === 'string')) {
        return t[rndInt(t.length - 1)];
    } else if (T === 'object') {
        const k = Object.keys(t);
        return t[k[rndInt(k.length - 1)]];
    } else {
        return undefined;
    }
}


function removeAll(t) {
    if (Array.isArray(t)) {
        t.length = 0;
    } else {
        for (var key in t){
            if (t.hasOwnProperty(key)){
                delete t[key];
            }
        }
    }
}


function removeValues(t, value) {
    if (Array.isArray(t)) {
        // Place to copy the next element to
        let dst = 0;
        for (let src = 0; src < t.length; ++src) {
            if (src > dst) { t[dst] = t[src]; }
            if (t[src] !== value) { ++dst; }
        }
        if (dst !== t.length) {
            t.length = dst;
        }
    } else if (typeof t === 'object') {
        for (let k in t) {
            if (t[k] === value) {
                delete t[k];
            }
        }
    }
}


function reverse(array) {
    if (! Array.isArray(array)) { throw new Error('reverse() takes an array as the argument'); }
    array.reverse();
}


function removeKey(t, i) {
    if (Array.isArray(t)) {
        if (typeof i !== 'number') { throw 'removeKey(array, i) called with a key (' + i + ') that is not a number'; }
        t.splice(i, 1);
    } else if (typeof t === 'object') {
        delete t[i];
    }
}


function extend(a, b) {
    if (Array.isArray(a)) {
        if (! Array.isArray(b)) {
            throw new Error('Both arguments to extend(a, b) must have the same type. Invoked with one array and one non-array.');
        }
        
        if (b.length < 1000) {
            Array.prototype.push.apply(a, b);
        } else {
            // JavaScript doesn't like arguments that have too many
            // elements, so we use a loop
            for (let i = 0; i < b.length; ++i) {
                a.push(b[i]);
            }
        }
    } else {
        if (Array.isArray(b)) {
            throw new Error('Both arguments to extend(a, b) must have the same type. Invoked with one object and one array.');
        }
        // Object
        for (let k in b) {
            a[k] = b[k];
        }
    }
}


function arrayValue(animation, frame, extrapolate) {
    switch (extrapolate || animation.extrapolate || 'clamp') {
    case 'oscillate':
        frame = oscillate(frame, animation.length) - 1;
        break;
    
    case 'loop':
        frame = loop(frame, animation.length);
        break;
        
    default:
        frame = _clamp(frame, 0, animation.length - 1)
    }
      
    return animation[Math.floor(frame)];
}


function concatenate(a, b) {
    if (Array.isArray(a)) {
        if (! Array.isArray(b)) {
            throw new Error('Both arguments to concatenate(a, b) must have the same type. Invoked with one array and one non-array.');
        }
        a = clone(a);
        extend(a, b);
        return a;
    } else if (isString(a)) {
        if (! isString(b)) {
            throw new Error('Both arguments to concatenate(a, b) must have the same type. Invoked with one string and one non-string.');
        }
        return a + b;
    } else {
        if (Array.isArray(b)) {
            throw new Error('Both arguments to concatenate(a, b) must have the same type. Invoked with one object and one array.');
        }
        a = clone(a);
        extend(a, b);
        return a;
    }
}


function fastRemoveKey(t, i) {
    if (Array.isArray(t)) {
        if (typeof i !== 'number') { throw 'fastRemoveKey(array, i) called with a key (' + i + ') that is not a number'; }
        let L = t.length;
        t[i] = t[L - 1];
        t.length = L - 1;
    } else if (typeof t === 'object') {
        delete t[key];
    }
}


function keys(t) {
    return Object.keys(t);
}

function values(t) {
    return Object.values(t);
}


/////////////////////////////////////////////////////////////////////
//
// String

function slice(a, s, e) {
    if (Array.isArray(a)) {
        return a.slice(s, e);
    } else if (isString(a)) {
        return a.substr(s, e);
    } else {
        throw new Error('slice() requires an array or string argument.');
    }
}


//////////////////////////////////////////////////////////////////////
//

function makeSpline(timeSrc, controlSrc, order, extrapolate) {
    // Argument checking
    if (controlSrc.length < 2) { throw new Error('Must specify at least two control points'); }
    if (order === undefined) { order = 3; }
    if (extrapolate === undefined) { extrapolate = 'stall'; }
    if (find(['stall', 'loop', 'clamp', 'continue', 'oscillate'], extrapolate) === undefined) {
        throw new Error('extrapolate argument to makeSpline must be "stall", "loop", "clamp", or "continue"');
    }
    
    order = Math.round(order);
    if (order === 2 || order < 0 || order > 3) { throw new Error('order must be 0, 1, or 3'); }

    // Clone the arrays
    const time = [], control = [];
    
    for (let i = 0; i < timeSrc.length; ++i) {
        time[i] = timeSrc[i];
        if ((i > 0) && (time[i] <= time[i - 1])) {
            throw new Error('times must increase through the array');
        }
        control[i] = clone(controlSrc[i]);
    }

    if (extrapolate === 'loop') {
        if (time.length !== controlSrc.length + 1) {
            throw new Error('There must be one more time than value to use "loop" extrapolation');
        }
        // Duplicate the last control point, which was previously null
        control[control.length - 1] = clone(control[0]);
    } else if (timeSrc.length !== controlSrc.length) {
        throw new Error('time and value arrays must have the same size');
    }   

    if (extrapolate === 'oscillate') {
        const N = control.length;

        // Convert to "loop"
        for (let i = 0; i < N - 1; ++i) {
            control[N + i] = control[N - i - 2];
            time[N + i] = time[N + i - 1] + (time[N - i - 1] - time[N - i - 2]);
        }
        extrapolate = 'loop';
    }

    // Number of control points, not included a potentially duplicated
    // one at the end to make wrapping math easier.
    const N = control.length - (extrapolate === 'loop' ? 1 : 0);


    // Time covered by all of the intervals between control points,
    // including the wrap one in loop mode. 
    const duration = time[time.length - 1] - time[0];

    /** Returns the requested control point and time sample based on
        array index.  If the array index is out of bounds, wraps (for
        a cyclic spline) or linearly extrapolates (for a non-cyclic
        spline), assuming time intervals follow the first or last
        sample recorded.

        Returns 0 if there are no control points.
    */
    function getControl(i, outTimeArray, outControlArray, outIndex) {
        let t, c;

        if (extrapolate === 'loop') {
            c = control[floor(loop(i, N))];
            if (i < 0) {
                // Wrapped around bottom

                // Number of times we wrapped around the cyclic array
                const wraps = floor((N + 1 - i) / N);
                const j = (i + wraps * N) % N;
                t = time[j] - wraps * duration;

            } else if (i < N) {
                // Normal case: no wrap
                t = time[i];

            } else {
                // Wrapped around top

                // Number of times we wrapped around the cyclic array
                const wraps = floor(i / N);
                const j = i % N;
                t = time[j] + wraps * duration;
            }

        } else if (i < 0) { // Not cyclic, off the low side

            // Step away from control point 0
            const dt = time[1] - time[0];
            
            if (extrapolate === 'continue') { // linear
                // Extrapolate (note; i is negative and an integer)
                c = lerp(control[0], control[1], i);
            } else {
                // Stall or clamp
                // Return the first, clamping the control point
                c = control[0];
            }
            t = dt * i + time[0];

        } else if (i >= N) { // Not cyclic, off the high side
            const dt = time[N - 1] - time[N - 2];
            
            if (extrapolate === 'continue') {
                // Extrapolate
                c = lerp(control[N - 2], control[N - 1], i - (N - 2));
            } else {
                // Stall or clamp
                // Return the last, clamping the control point
                c = control[N - 1];
            }
            // Extrapolate
            t = time[N - 1] + dt * (i - N + 1);

        } else {
            // Normal case: in bounds, no extrapolation needed
            c = control[i];
            t = time[i];
        }
        
        outControlArray[outIndex] = c;
        outTimeArray[outIndex] = t;
    }


    /** Derived from the G3D Innovation Engine (https://casual-effects.com/g3d).
        Assumes that time[0] <= s < time[N - 1] + time[0].  called by computeIndex. Returns {i, u} */
    function computeIndexInBounds(s) {
        console.assert((s < time[N - 1] + time[0]) && (time[0] <= s));
        const t0 = time[0];
        const tn = time[N - 1];

        if (s > time[N - 1]) {
            console.assert(extrapolate === 'loop');
            return {i:N - 1, u:(s - time[N - 1]) / (time[N] - time[N - 1])};
        }

        // Guess a linear start index
        let i = floor((N - 1) * (s - t0) / (tn - t0));
    
        // Inclusive bounds for binary search
        let hi = N - 1;
        let lo = 0;
    
        while ((time[i] > s) || ((i < time.length - 1) && (time[i + 1] <= s))) {
            if (hi <= lo) {
                console.log(lo, hi, i, s);
                throw new Error('Infinite loop?');
            }

            if (time[i] > s) {
                // value at current index is too big. Look on
                // the lower half.
                hi = i - 1;
            } else if (time[i + 1] <= s) {
                // value at current index is too small. Look
                // on the upper half
                lo = i + 1;
            }
            
            i = (hi + lo) >> 1;
        }
    
        // Having exited the above loop, i must be correct, so compute u.
        if (i === N - 1) {
            return {i:i, u:0};
        } else {
            return {i: i, u: (s - time[i]) / (time[i + 1] - time[i])};
        }
    }


    /**
       Given a time @a s, finds @a i and 0 <= @a u < 1 such that
       @a s = time[@a i] * @a u + time[@a i + 1] * (1 - @a u).  Note that
       @a i may be outside the bounds of the time and control arrays;
       use getControl to handle wraparound and extrapolation issues.
       
       This function takes expected O(1) time for control points with
       uniform time sampled control points or for uniformly
       distributed random time samples, but may take O( log time.size() ) time
       in the worst case.

       Called from evaluate(). returns {i, u}
    */
    function computeIndex(s) {
        let i, u;
        const t0 = time[0];
        const tn = time[N - 1];
    
        if (extrapolate === 'loop') {
            // Cyclic spline
            if ((s < t0) || (s >= time[N])) {
                // Cyclic, off the bottom or top.
                // Compute offset and reduce to the in-bounds case.

                // Number of times we wrapped around the cyclic array
                const wraps = floor((s - t0) / duration);
                const result = computeIndexInBounds(s - duration * wraps);
                result.i += wraps * N;
                return result;
                
            } else if (s >= tn) {
                // Cyclic, off the top but before the end of the last interval
                i = N - 1;
                u = (s - tn) / (time[N] - tn);
                return {i:i, u:u};
            
            } else {
                // Cyclic, in bounds
                return computeIndexInBounds(s);
            }
            
        } else {
            // Non-cyclic
            if (s < t0) {
                // Non-cyclic, off the bottom.  Assume points are spaced
                // following the first time interval.
                const dt = time[1] - t0;
                const x = (s - t0) / dt;
                i = Math.floor(x);
                u = x - i;
                return {i:i, u:u};
                
            } else if (s >= tn) {
                // Non-cyclic, off the top.  Assume points are spaced following
                // the last time interval.
                const dt = tn - time[N - 2];
                const x = (N - 1) + (s - tn) / dt;
                i = Math.floor(x);
                u = x - i;
                return {i:i, u:u};
                
            } else {
                // In bounds, non-cyclic.  Assume a regular
                // distribution (which gives O(1) for uniform spacing)
                // and then binary search to handle the general case
                // efficiently.
                return computeIndexInBounds(s);
                
            } // if in bounds
        } // extrapolation Mode
    } // computeIndex
    

    /* Derived from the G3D Innovation Engine (https://casual-effects.com/g3d).
       Return the position at time s.  The spline is defined outside
       of the time samples by extrapolation or cycling. */
    function evaluate(s) {
        if (extrapolate === 'clamp') {
            if (s < time[0]) { return clone(control[0]); }
            else if (s > time[N - 1]) { return clone(control[N - 1]); }
        }
        
        const indexResult = computeIndex(s);
        // Index of the first control point
        const i = indexResult.i;
        // Fractional part of the time
        const u = indexResult.u;

        // Array of 4 control points and control times.
        // p[1] is the one below this time and p[2] is above it.
        // The others are needed to provide derivatives at the ends
        let p = [], t = [];
        for (let j = 0; j < N; ++j) {
            getControl(i + j - 1, t, p, j);
        }

        if (order === 0) {
            return clone(p[1]);
        } else if (order === 1) {
            const a = (s - t[1]) / (t[2] - t[1]);
            return lerp(p[1], p[2], a);
        }

        // Time deltas
        const dt0 = t[1] - t[0];
        const dt1 = t[2] - t[1];
        const dt2 = t[3] - t[2];

        const dp0 = _sub(p[1], p[0]);
        const dp1 = _sub(p[2], p[1]);
        const dp2 = _sub(p[3], p[2]);

        // The factor of 1/2 from averaging two time intervals is 
        // already factored into the basis
        
        // tan1 = (dp0 / dt0 + dp1 / dt1) * ((dt0 + dt1) * 0.5);
        // The last term normalizes for unequal time intervals
        const x = (dt0 + dt1) * 0.5;
        
        const n0 = x / dt0;
        const n1 = x / dt1;
        const n2 = x / dt2;

        const dp1n1 = _mul(dp1, n1);
        
        const tan1 = _add(_mul(dp0, n0), dp1n1);
        const tan2 = _add(dp1n1, _mul(dp2, n2));

        // Powers of the fractional part, u
        const uvec = [u * u * u, u * u, u, 1];

        // Compute the weights on each of the control points/tangents
        const basis = [ 0.5,  2.0, -2.0,  0.5,
                       -1.0, -3.0,  3.0, -0.5,
                        0.5,  0.0,  0.0,  0.0,
                       -0.0,  1.0,  0.0,  0.0];

        // Matrix product
        const weights = [0, 0, 0, 0];
        for (let i = 0; i < 4; ++i) {
            for (let j = 0; j < 4; ++j) {
                weights[i] += uvec[j] * basis[i + 4 * j];
            }
        }

        return _add(_add(
                    _add(_mul(tan1, weights[0]),
                         _mul(p[1], weights[1])),
                         _mul(p[2], weights[2])),
                         _mul(tan2, weights[3]));
    }

    return evaluate;
}

//////////////////////////////////////////////////////////////////////
//
// Function

function call(f) {
    return Function.call.apply(f, arguments);
}

//////////////////////////////////////////////////////////////////////

/** Set by the IDE. A view onto the imagedata */
var _updateImageDataUint32;

/** Set by reloadRuntime(). 128x23 Uint8 array */
var _fontSheet = null;

/** Callback to show the screen buffer and yield to the browser. Set by
    reloadRuntime() */
var _submitFrame = null;

// Scissor (setClipping) region. This is inclusive and is expressed in
// terms of pixel indices.
var _clipY1 = 0, _clipY2 = _SCREEN_HEIGHT - 1, _clipZ1 = -2047, _clipX1 = 0, _clipX2 = _SCREEN_WIDTH - 1, _clipZ2 = 2048;

// Draw call offset
var _offsetX = 0, _offsetY = 0, _offsetZ = 0, _scaleX = 1, _scaleY = 1, _scaleZ = 1, _skewXZ = 0, _skewYZ = 0;

var _graphicsStateStack = [];


function _pushGraphicsState() {
    _graphicsStateStack.push({
        cx1:_clipX1, cy1:_clipY1, cz1:_clipZ1,
        cx2:_clipX2, cy2:_clipY2, cz2:_clipZ2, 
        ax:_offsetX, ay:_offsetY, az:_offsetZ,
        sx:_scaleX,  sy:_scaleY,  sz:_scaleZ,
        kx:_skewXZ,  ky:_skewYZ
    });
}


function _popGraphicsState() {
    const s = _graphicsStateStack.pop();
    _offsetX = s.ax; _offsetY = s.ay; _offsetZ = s.az;
    _scaleX = s.sx; _scaleY = s.sy; _scaleZ = s.sz;
    _skewXZ = s.kx; _skewYZ = s.ky;

    _clipX1 = s.cx1; _clipY1 = s.cy1; _clipZ1 = s.cz1;
    _clipX2 = s.cx2; _clipY2 = s.cy2; _clipZ2 = s.cz2;
}


function getTransform() {
    return [_offsetX, _offsetY, _offsetZ, _scaleX, _scaleY, _scaleZ, _skewXZ, _skewYZ];
}


function getRotationSign() {
    return -_Math.sign(_scaleX * _scaleY);
}


function getYUp() {
    return -_Math.sign(_scaleY);
}


function resetTransform() {
    _offsetX = _offsetY = _offsetZ = _skewXZ = _skewYZ = 0;
    _scaleX = _scaleY = _scaleZ = 1;
}


function setTransform(pos, dir, addZ, scaleZ, skew) {
    if (arguments.length === 0) { throw new Error("setTransform() called with no arguments"); }
    if (isObject(pos) && (('pos' in pos) || ('dir' in pos) || ('z' in pos) || ('skew' in pos))) {
        // Argument version
        return setTransform(pos.pos, pos.dir, pos.z, pos.skew);
    }

    let addX, addY, scaleX, scaleY, skewXZ, skewYZ;
    if (pos !== undefined) {
        if (isNumber(pos)) {
            throw new Error("pos argument to setTransform() must be an xy() or nil");
        }
        addX = pos.x; addY = pos.y;
    }
    if (dir !== undefined) { scaleX = dir.x; scaleY = dir.y; }
    if (skew !== undefined) { skewXZ = skew.x; skewYZ = skew.y; }

    if (addX === undefined) { addX = _offsetX; }
    if (addY === undefined) { addY = _offsetY; }
    if (addZ === undefined) { addZ = _offsetZ; }
    if (scaleX === undefined) { scaleX = _scaleX; }
    if (scaleY === undefined) { scaleY = _scaleY; }
    if (scaleZ === undefined) { scaleZ = _scaleZ; }
    if (skewXZ === undefined) { skewXZ = _skewXZ; }
    if (skewYZ === undefined) { skewYZ = _skewYZ; }
        
    _offsetX = addX;
    _offsetY = addY;
    _offsetZ = addZ;

    _scaleX = (scaleX === -1) ? -1 : +1;
    _scaleY = (scaleY === -1) ? -1 : +1;
    _scaleZ = (scaleZ === -1) ? -1 : +1;

    _skewXZ = skewXZ;
    _skewYZ = skewYZ;
}


function transformDrawToScreen(coord, z) {
    z = z || 0;
    return xy((coord.x + (z * _skewXZ)) * _scaleX + _offsetX,
              (coord.y + (z * _skewYZ)) * _scaleY + _offsetY);
}


function transformDrawZToScreenZ(z) {
    return z * _scaleZ + _offsetZ;
}


function transformScreenToDraw(coord) {
    return xy((coord.x - _offsetX) / _scaleX, (coord.y - _offsetY) / _scaleY);
}


function transformScreenZToDrawZ(z) {
    return (z - _offsetZ) / _scaleZ;
}


function intersectClip(x1, y1, z1, dx, dy, dz) {
    if (x1 === undefined) { x1 = _clipX1; }
    if (y1 === undefined) { y1 = _clipY1; }
    if (z1 === undefined) { z1 = _clipZ1 }
    if (dx === undefined) { dx = _clipX2 - _clipX1 + 1; }
    if (dy === undefined) { dy = _clipY2 - _clipY1 + 1; }
    if (dz === undefined) { dz = _clipZ2 - _clipZ1 + 1; }

    let x2 = x1 + dx, y2 = y1 + dy, z2 = z1 + dz;
    
    // Order appropriately
    if (x2 < x1) { let temp = x1; x1 = x2; x2 = temp; }
    if (y2 < y1) { let temp = y1; y1 = y2; y2 = temp; }
    if (z2 < z1) { let temp = z1; z1 = z2; z2 = temp; }
    
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    z1 = Math.round(z1);

    x2 = Math.floor(x2 - 0.5);
    y2 = Math.floor(y2 - 0.5);
    z2 = Math.floor(z2 - 0.5);

    _clipX1 = _clamp(Math.max(x1, _clipX1), 0, _SCREEN_WIDTH - 1);
    _clipY1 = _clamp(Math.max(y1, _clipY1), 0, _SCREEN_HEIGHT - 1);
    _clipZ1 = _clamp(Math.max(z1, _clipZ1), -2047, 2048);
    
    _clipX2 = _clamp(Math.min(x2, _clipX2), 0, _SCREEN_WIDTH - 1);
    _clipY2 = _clamp(Math.min(y2, _clipY2), 0, _SCREEN_HEIGHT - 1);
    _clipZ2 = _clamp(Math.min(z2, _clipZ2), -2047, 2048);
}


function resetClip() {
    _clipX1 = _clipY1 = 0;
    _clipZ1 = -2047;
    _clipX2 = _SCREEN_WIDTH - 1;
    _clipY2 = _SCREEN_HEIGHT - 1;
    _clipZ2 = 2048;
}


function setClip(pos, size, z1, dz) {
    if (pos.pos || pos.size || pos.z || pos.zSize) {
        return setClip(pos.pos, pos.size, pos.z, pos.zSize);
    }
    
    let x1, y1, dx, dy;
    if (pos !== undefined) {
        if (isNumber(pos)) { throw new Error('pos argument to setClip() must be an xy() or nil'); }
        x1 = pos.x; y1 = pos.y;
    }
    if (size !== undefined) {
        if (isNumber(size)) { throw new Error('size argument to setClip() must be an xy() or nil'); }
        dx = size.x; dy = size.y;
    }
    
    if (x1 === undefined) { x1 = _clipX1; }
    if (y1 === undefined) { y1 = _clipY1; }
    if (z1 === undefined) { z1 = _clipZ1; }
    if (dx === undefined) { dx = _clipX2 - _clipX1 + 1; }
    if (dy === undefined) { dy = _clipY2 - _clipY1 + 1; }
    if (dz === undefined) { dz = _clipZ2 - _clipZ1 + 1; }

    let x2 = x1 + dx, y2 = y1 + dy, z2 = z1 + dz;

    // Order appropriately
    if (x2 < x1) { let temp = x1; x1 = x2; x2 = temp; }
    if (y2 < y1) { let temp = y1; y1 = y2; y2 = temp; }
    if (z2 < z1) { let temp = z1; z1 = z2; z2 = temp; }
    
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    z1 = Math.round(z1);

    x2 = Math.floor(x2 - 0.5);
    y2 = Math.floor(y2 - 0.5);
    z2 = Math.floor(z2 - 0.5);

    _clipX1 = _clamp(Math.max(x1, _clipX1), 0, _SCREEN_WIDTH - 1);
    _clipY1 = _clamp(Math.max(y1, _clipY1), 0, _SCREEN_HEIGHT - 1);
    _clipZ1 = _clamp(Math.max(z1, _clipZ1), -2047, 2048);
    
    _clipX2 = _clamp(Math.min(x2, _clipX2), 0, _SCREEN_WIDTH - 1);
    _clipY2 = _clamp(Math.min(y2, _clipY2), 0, _SCREEN_HEIGHT - 1);
    _clipZ2 = _clamp(Math.min(z2, _clipZ2), -2047, 2048);
}


function abs(x) {
    return (x.length !== undefined) ? x.length : Math.abs(x);
}

var sin = Math.sin;
var cos = Math.cos;
var tan = Math.tan;
var acos = Math.acos;
var asin = Math.asin;
var atan = Math.atan2;
var log = Math.log;
var sign = Math.sign;
var exp = Math.exp;
var sqrt = Math.sqrt;
var cbrt = Math.cbrt;

function signNonZero(x) { return (x < 0) ? -1 : 1; }

var _screen;


/** List of graphics commands to be sorted and then executed by show(). */
var _previousGraphicsCommandList = [];
var _graphicsCommandList = [];
var _background = Object.seal({r:0,g:0,b:0,a:1});

function _makePad(index) {
    return Object.seal({
        x:0, dx:0, y:0, dy:0, xx:0, yy:0,
        angle:0, dangle:0,
        a:0, b:0, c:0, d:0, p:0, q:0,
        aa:0, bb:0, cc:0, dd:0, pp:0, qq:0,
        pressedA:0, pressedB:0, pressedC:0, pressedD:0, pressedP:0, pressedQ:0,
        releasedA:0, releasedB:0, releasedC:0, releasedD:0, releasedP:0, releasedQ:0,
        index: index,
        prompt: Object.seal({
            a: 'ⓐ',
            b: 'ⓑ',
            c: 'ⓒ',
            d: 'ⓓ',
            p: 'ⓟ',
            q: 'ⓠ',
            up: '⍐',
            lt: '⍇',
            dn: '⍗',
            rt: '⍈'
        })
    });
}

var joy = _makePad(0);
var pad = [joy, _makePad(1), _makePad(2), _makePad(3)];

var _hashview = new DataView(new ArrayBuffer(8));

function _hash(d) {
    // 32-bit FNV-1a
    var hval = 0x811c9dc5;
    
    if (d.length) {
        // String
        for (var i = d.length - 1; i >= 0; --i) {
            hval ^= d.charCodeAt(i);
            hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
        }
    } else {
        // Number
        _hashview.setFloat64(0, d);
        for (var i = 7; i >= 0; --i) {
            hval ^= _hashview.getUint8(i);
            hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
        }

        // Near integers, FNV sometimes does a bad job because it doesn't
        // mix the low bits enough. XOR with some well-distributed
        // bits
        hval ^= (_fract(Math.sin(d * 10) * 1e6) * 0xffffffff) | 0;
    }
    
    // Force to unsigned 32-bit
    return (hval >>> 0);
}


function hash(x, y) {
    var h = _hash(x);
    if (y !== undefined) {
        var hy = _hash(y);
        h ^= ((hy >> 16) & 0xffff) | ((hy & 0xffff) << 16);
    }
    
    return Math.abs(h) / 0xffffffff;
}

function _lerp(a, b, t) { return a * (1 - t) + b * t; }

// Fast 1D "hash" used by noise()
function _nhash1(n) { n = Math.sin(n) * 1e4; return n - Math.floor(n); }

// bicubic fbm value noise
// from https://www.shadertoy.com/view/4dS3Wd
function noise(octaves, x, y, z) {
    // Set any missing axis to zero
    x = x || 0;
    y = y || 0;
    z = z || 0;

    // Maximum value is 1/2 + 1/4 + 1/8 ... from the straight summation
    // The max is always pow(2,-octaves) less than 1.
    // So, divide by (1-pow(2,-octaves))
    octaves = Math.max(1, (octaves || 1) | 0);
    var v = 0, k = 1 / (1 - Math.pow(2, -octaves));

    var stepx = 110, stepy = 241, stepz = 171;
    
    for (; octaves > 0; --octaves) {
        
        var ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
        var fx = x - ix,        fy = y - iy,        fz = z - iz;
 
        // For performance, compute the base input to a 1D hash from the integer part of the argument and the 
        // incremental change to the 1D based on the 3D -> 1D wrapping
        var n = ix * stepx + iy * stepy + iz * stepz;

        var ux = fx * fx * (3 - 2 * fx),
            uy = fy * fy * (3 - 2 * fy),
            uz = fz * fz * (3 - 2 * fz);

        v += (_lerp(_lerp(_lerp(_nhash1(n), _nhash1(n + stepx), ux),
                          _lerp(_nhash1(n + stepy), _nhash1(n + stepx + stepy), ux), uy),
                    _lerp(_lerp(_nhash1(n + stepz), _nhash1(n + stepx + stepz), ux),
                          _lerp(_nhash1(n + stepy + stepz), _nhash1(n + stepx + stepy + stepz), ux), uy), uz) - 0.5) * k;

        // Grab successive octaves from very different parts of the space, and
        // double the frequency
        x = 2 * x + 109;
        y = 2 * y + 31;
        z = 2 * z + 57;
        k *= 0.5;
    }
    
    return v;
}


function _noop() {}


function vec(x, y, z, w) {
    if (w !== undefined) {
        return {x:x, y:y, z:z, w:w}
    } else if (z !== undefined) {
        return {x:x, y:y, z:z}
    } else {
        return {x:x, y:y}
    }
}

function _error(msg) {
    throw new Error(msg);
}


function xy(x, y) {
    if (x.x !== undefined) {
        return {x:x.x, y:x.y};
    }
    if (arguments.length !== 2) { _error('xy() requires exactly two arguments'); }
    return {x:x, y:y};
}


function xyz(x, y, z) {
    if (arguments.length !== 3) { throw new Error('xyz() requires exactly three arguments'); }
    return {x:x, y:y, z:z};
}


function equivalent(a, b) {
    switch (typeof a) {
    case 'number':
    case 'string':
    case 'function':
        return a === b;
        
    default:
        if (a.length !== b.length) { return false; }
        for (let key in a) if (a[key] !== b[key]) { return false; }
        return true;
    }
}


function gray(r) {
    if (r.h !== undefined) {
        // HSV -> RGB
        r = rgb(r);
    }
    
    if (r.r !== undefined) {
        // RGB -> grayscale. We're in sRGB space, where the actual grayscale conversion has to
        // be nonlinear, so this is a very coarse approximation.
        r = r.r * 0.35 + r.g * 0.50 + r.b * 0.15;
    }
    
    return rgb(r, r, r);
}


function rgb(r, g, b) {
    if (arguments.length !== 3 && arguments.length !== 1) { throw new Error('rgb() requires exactly one or three arguments or one hsv value'); }

    if (r.h !== undefined) {
        // Convert to RGB
        const h = loop(r.h, 1), s = _clamp(r.s, 0, 1), v = _clamp(r.v, 0, 1);
        r = v * (1 - s + s * _clamp(Math.abs(_fract(h + 1.0) * 6 - 3) - 1, 0, 1));
        g = v * (1 - s + s * _clamp(Math.abs(_fract(h + 2/3) * 6 - 3) - 1, 0, 1));
        b = v * (1 - s + s * _clamp(Math.abs(_fract(h + 1/3) * 6 - 3) - 1, 0, 1));
    } else if (r.r) {
        // Clone
        g = r.g;
        b = r.b;
        r = r.r;
    } else {
        r = _clamp(r, 0, 1);
        g = _clamp(g, 0, 1);
        b = _clamp(b, 0, 1);
    }
    
    return {r:r, g:g, b:b};
}


function rgba(r, g, b, a) {
    if (r.h !== undefined) {
        // Convert to RGB
        const c = rgb(r);

        // add a
        if (r.a !== undefined) {
            c.a = r.a;
        } else {
            c.a = 1;
        }
        return c;
    } else if (r.r) {
        // Clone
        a = (r.a === undefined) ? 1 : r.a;
        g = r.g;
        b = r.b;
        r = r.r;
    } else {
        r = _clamp(r, 0, 1);
        g = _clamp(g, 0, 1);
        b = _clamp(b, 0, 1);
        a = _clamp(a, 0, 1);
    }
    
    return {r:r, g:g, b:b, a:a};
}


function hsv(h, s, v) {
    if (h.r !== undefined) {
        // convert to hsv
        const r = _clamp(h.r, 0, 1), g = _clamp(h.g, 0, 1), b = _clamp(h.b, 0, 1);

        v = Math.max(r, g, b);

        if (v === 0) {
            h = 0; s = 0;
        } else {
            const mn = Math.min(r, g, b);
            s = 1 - mn / v;
            
            if (r === v)      h =     (g - b); // between yellow & magenta
            else if (g === v) h = 2 + (b - r); // between cyan & yellow
            else              h = 4 + (r - g); // between magenta & cyan

            h /= 6 * (v - mn);
            if (h < 0) h += 1;
        }
    } else if (h.h) {
        // clone
        v = h.v;
        s = h.s;
        h = h.h;
    }

    return {h:h, s:s, v:v};
}


function hsva(h, s, v, a) {
    if (h.r !== undefined) {
        const c = hsv(h);
        c.a = (h.a !== undefined) ? h.a : 1;
        return c;
    } else if (h.h !== undefined) {
        // clone
        a = h.a === undefined ? 1 : h.a;
        v = h.v;
        s = h.s;
        h = h.h;
    }
    
    return {h:h, s:s, v:v, a:a};
}


Math.mid = function(a, b, c) {
    if (a < b) {
        if (b < c) {
            // a < b < c
            return b;
        } else if (a < c) {
            // a < c <= b
            return c;
        } else {
            // c <= a < b
            return a;
        }
    } else if (a < c) {
        return a;
    } else if (b < c) {
        // b < c <= a
        return c;
    } else {
        return b;
    }
}

function _lerp(x, y, a) { return (1 - a) * x + a * y; }
function _clamp(x, lo, hi) { return Math.min(Math.max(x, lo), hi); }
function _fract(x) { return x - Math.floor(x); }
function _square(x) { return x * x; }

/*************************************************************************************/
// Entity functions

function transformDrawToSprite(entity, coord) {
    // Can be optimized as a single operation later
    return transformEntityToSprite(entity, transformDrawToEntity(entity, coord));
}

function transformSpritetoDraw(entity, coord) {
    // Can be optimized as a single operation later
    return transformEntityToDraw(entity, transformSpriteToEntity(entity, coord));
}

function transformEntityToSprite(entity, coord) {
    if (! entity || entity.pos === undefined |! coord || coord.x === undefined) { throw new Error("Requires both an entity and a coordinate"); }
    return xy(coord.x * _scaleX + entity.sprite.size.x * 0.5,
              coord.y * _scaleY + entity.sprite.size.y * 0.5);
}


function transformSpriteToEntity(entity, coord) {
    if (! entity || entity.pos === undefined |! coord || coord.x === undefined) { throw new Error("Requires both an entity and a coordinate"); }
    return xy((coord.x - entity.sprite.size.x * 0.5) / _scaleX,
              (coord.y - entity.sprite.size.y * 0.5) / _scaleY);
}


function transformDrawToEntity(entity, coord) {
    if (! entity || entity.pos === undefined |! coord || coord.x === undefined) { throw new Error("Requires both an entity and a coordinate"); }
    const a = entity.angle * -getRotationSign();
    const C = Math.cos(a);
    const S = Math.sin(a);
    
    const Xx =  C, Xy = S;
    const Yx = -S, Yy = C;

    const x = coord.x - entity.pos.x, y = coord.y - entity.pos.y;
    return xy((x * Xx + y * Yx) / entity.scale.x,
              (x * Xy + y * Yy) / entity.scale.y);
}


function transformEntityToDraw(entity, coord) {
    if (! coord || coord.x == undefined) { throw new Error("transformEntityToDraw() requires both an entity and a coordinate"); }

    const a = entity.angle * -getRotationSign();
    const C = Math.cos(a);
    const S = Math.sin(a);

    const Xx =  C, Xy = S;
    const Yx = -S, Yy = C;

    const x = coord.x * entity.scale.x, y = coord.y * entity.scale.y;
    return xy(x * Xx + y * Xy + entity.pos.x, x * Yx + y * Yy + entity.pos.y);
}


function drawEntity(e, recurse) {
    if (e === undefined) { throw new Error("nil entity in drawEntity()"); }
    if (recurse === undefined) { recurse = true; }

    if (_showEntityBoundsEnabled) {
        drawBounds(e, false);
    }
    
    if (e.sprite) {
        // Shift the transform temporarily to support the offset without
        // memory allocation
        const oldX = _offsetX, oldY = _offsetY;
        _offsetX += e.offset.x * _scaleX; _offsetY += e.offset.y * _scaleY;
        drawSprite(e.sprite, e.pos, e.angle, e.scale, e.opacity, e.z, e.spriteOverrideColor);
        _offsetX = oldX; _offsetY = oldY;
    }

    if (e.childArray && recurse) {
        const N = e.childArray.length;
        for (let i = 0; i < N; ++i) {
            drawEntity(e.childArray[i], recurse);
        }
    }

    if (e.labelFont && e.labelText) {
        const oldX = _offsetX, oldY = _offsetY;
        _offsetX += (e.offset.x + e.textOffset.x) * _scaleX; _offsetY += (e.offset.y + e.textOffset.y) * _scaleY;
        drawText(e.font, e.text, e.pos, e.textColor, e.textShadow, e.textOutline, e.textXAlign, e.textYAlign, e.z);
        _offsetX = oldX; _offsetY = oldY;
    }
}


// Not public because it isn't a very good test yet.
function _isEntity(e) {
    return e.shape && e.pos && e.vel && e.acc;
}


function makeEntity(e, childTable) {
    const r = Object.assign({}, e || {});    

    if (e.shape && (e.shape !== 'rect') && (e.shape !== 'disk')) {
        throw new Error('Illegal shape for entity: "' + e.shape + '"');
    }

    // Clone vector components
    r.pos = r.pos ? clone(r.pos) : xy(0, 0);
    r.vel = r.vel ? clone(r.vel) : xy(0, 0);
    r.acc = r.acc ? clone(r.acc) : xy(0, 0);
    r.force = r.force ? clone(r.force) : xy(0, 0);

    r.angle = r.angle || 0;
    r.spin = r.spin || 0;
    r.twist = r.twist || 0;
    r.torque = r.torque || 0;
    
    r.spriteOverrideColor = clone(r.spriteOverrideColor);
    
    r.scale = r.scale ? clone(r.scale) : xy(1, 1);
    r.offset = r.offset ? clone(r.offset) : xy(0, 0);
    
    // Assign empty fields with reasonable defaults
    r.name = r.name || 'Anonymous';
    r.shape = r.shape || 'rect';
    r.sprite = r.sprite || undefined;
    r.z = r.z || 0;

    if (r.density === undefined) { r.density = 1; }

    // Clone colors if present
    r.labelXAlign = r.labelXAlign || 0;
    r.labelYAlign = r.labelYAlign || 0;
    r.labelOffset = r.labelOffset || xy(0, 0);
    r.labelShadow = clone(r.labelShadow);
    r.labelColor = clone(r.labelColor);
    r.labelColor = clone(r.labelColor);
    
    if (r.opacity === undefined) {
        r.opacity = 1;
    }
    
    if (r.size === undefined) {
        if (r.sprite) {
            if (r.shape === 'rect') {
                r.size = clone(r.sprite.size);
            } else if (r.shape === 'disk') {
                const x = minComponent(r.sprite.size) * r.scale.x;
                r.size = xy(x, x);
                if (r.scale.x != r.scale.y) {
                    throw new Error('Cannot have different scale factors for x and y on a "disk" shaped entity.');
                }
            }
        } else {
            // no size, no sprite
            r.size = xy(0, 0);
        }
    } else {
        r.size = clone(r.size);
    }

    const childArray = r.childArray ? clone(r.childArray) : [];
    r.childArray = [];
    if (r.orientWithParent === undefined) { r.orientWithParent = true; }
    if (r.offsetWithParent === undefined) { r.offsetWithParent = true; }
   
    r.zInParent = r.zInParent || 0;
    r.posInParent = r.posInParent ? clone(r.posInParent) : xy(0, 0);
    r.angleInParent = r.angleInParent || 0;
    r.offsetInParent = r.offsetInParent ? clone(r.offsetInParent) : xy(0, 0);
    r.scaleInParent = r.scaleInParent ? clone(r.scaleInParent) : xy(1, 1);

    // Construct named children
    if (childTable) {
        for (let name in childTable) {
            const child = childTable[name];
            if (! _isEntity(child)) {
                throw new Error('The child named "' + name + '" in the childTable passed to makeEntity is not itself an entity');
            }
            
            if (r[name] !== undefined) {
                throw new Error('makeEntity() cannot add a child named "' + name +
                                '" because that is already a property of the entity {' + Object.keys(r) + '}');
            }
            r[name] = child;
            if (child.name === 'Anonymous') {
                child.name = name;
            }
            childArray.push(child)
        }
    }

    // Add and update all children
    for (let i = 0; i < childArray.length; ++i) {
        addEntityChild(r, childArray[i]);
    }
    updateEntityChildren(r);
    
    return r;
}


function addEntityChild(parent, child) {
    if (! child) { return child; }
    
    removeEntityChild(parent, child);
    
    child.parent = parent;
    // Avoid accidental duplicates
    if (parent.childArray.indexOf(child) === -1) {
        parent.childArray.push(child);
    }
    return child;
}


function removeEntityChild(parent, child) {
    if (! child) { return child; }
    
    if (child.parent) {
        if (parent !== child.parent) {
            throw new Error('Tried to remove a child from the wrong parent')
        }
        // remove from previous parent
        removeValues(child.parent.childArray, child);
    } else {
        for (let i = 0; i < parent.childArray.length; ++i) {
            if (parent.childArray[i] === child) {
                throw new Error('Tried to remove a child that did not have a pointer back to its parent');
            }
        }
    }
    
    child.parent = undefined;
    return child;
}


function transformEntityToEntity(e1, e2, pos) {
    return transformDrawToEntity(e2, transformEntityToDraw(e1, pos));
}


function transformParentToChild(child, pos) {
    let a = child.parent.angle - child.angle;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = pos.x - child.posInParent.x;
    const y = pos.y - child.posInParent.y;
    
    return xy( c * x + s * y,
              -s * x + c * y)
}


function transformChildToParent(child, pos) {
    let a = child.angle - child.parent.angle;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return xy( c * pos.x + s * pos.y + child.posInParent.x,
              -s * pos.x + c * pos.y + child.posInParent.y)
}


// Recursively update all properties of the children
function updateEntityChildren(parent) {
    if (parent === undefined || parent.pos === undefined) {
        throw new Error('updateEntityChildren requires an entity argument')
    }
    
    const N = parent.childArray.length;
    for (let i = 0; i < N; ++i) {
        const child = parent.childArray[i];
        const rotSign = Math.sign(parent.scale.x * parent.scale.y);

        if (child.orientWithParent) {
            child.scale.x = parent.scale.x * child.scaleInParent.x;
            child.scale.y = parent.scale.y * child.scaleInParent.y;
            
            child.angle   = parent.angle + child.angleInParent * rotSign;
        }
       
        const a = parent.angle * getRotationSign() * rotSign;
        const c = Math.cos(a), s = Math.sin(a);
        child.pos.x = (c * child.posInParent.x - s * child.posInParent.y) * parent.scale.x + parent.pos.x;
        child.pos.y = (s * child.posInParent.x + c * child.posInParent.y) * parent.scale.y + parent.pos.y;
        child.z = parent.z + child.zInParent;

        if (child.offsetWithParent) {
            child.offset.x = (c * child.offsetInParent.x - s * child.offsetInParent.y) * parent.scale.x + parent.offset.x;
            child.offset.y = (s * child.offsetInParent.x + c * child.offsetInParent.y) * parent.scale.y + parent.offset.y;
        }
      
        updateEntityChildren(child);
    }
}


function physicsStepEntity(entity, dt) {
    if (dt === undefined) { dt = 1; }
    const mass = entityMass(entity);
    const imass = 1 / mass;
    const iinertia = 1 / entityInertia(entity, mass);
    const acc = entity.acc, vel = entity.vel, pos = entity.pos;

    // Overwrite
    acc.x  = entity.force.x * imass;
    acc.y  = entity.force.y * imass;

    // Integrate
    vel.x += acc.x * dt;
    vel.y += acc.y * dt;

    pos.x += vel.x * dt;
    pos.y += vel.y * dt;

    // Overwrite
    entity.twist  = entity.torque * iinertia;

    // Integrate
    entity.spin  += entity.twist * dt;
    entity.angle += entity.spin * dt

    // Zero for next step
    entity.torque = 0;
    entity.force.x = entity.force.y = 0;
}

/*************************************************************************************/
//
// Graphics functions

// Snap points to the pixels that they cover. This follows our rule of
// integer pixel CORNERS and BOTTOM-RIGHT coverage rules at pixel
// centers.
var _pixelSnap = Math.floor;

function transformMapLayerToDrawZ(map, layer) {
    return layer * map.zScale + map.zOffset;
}


function transformDrawZToMapLayer(map, z) {
    return (z - map.zOffset) / map.zScale;
}


function transformMapToDraw(map, mapCoord) {
    return xy(mapCoord.x * map.spriteSize.x + map._offset.x,
              mapCoord.y * map.spriteSize.y + map._offset.y);
}


function transformDrawToMap(map, drawCoord) {
    return xy((drawCoord.x - map._offset.x) / map.spriteSize.x,
              (drawCoord.y - map._offset.y) / map.spriteSize.y);
}


function getMapPixelColor(map, mapCoord, layer, replacementArray) {
    layer = Math.round(layer || 0);
    let mx = Math.floor(mapCoord.x);
    let my = Math.floor(mapCoord.y);

    if (map.wrapX) { mx = loop(mx, map.size.x); }
    if (map.wrapY) { my = loop(my, map.size.y); }

    if ((layer >= 0) && (layer < map.layer.length) &&
        (mx >= 0) && (my >= 0) &&
        (mx < map.size.x) && (my < map.size.y)) {
        // In bounds
        
        let sprite = map.layer[layer][mx][my];
        if (sprite) {
            if (replacementArray) {
                for (let i = 0; i < replacementArray.length; i += 2) {
                    if (replacementArray[i] === sprite) {
                        sprite = replacementArray[i + 1];
                        break;
                    }
                }
            }
            
            // Map coord (0, 0) is the corner of the corner sprite.
            const ssX = sprite.size.x, ssY = sprite.size.y;
            const spriteCoord = {x:_clamp(Math.floor((mapCoord.x - mx) * ssX), 0, ssX - 1),
                                 y:_clamp(Math.floor((mapCoord.y - my) * ssY), 0, ssY - 1)};

            // Account for the automatic flipping that occurs to sprites when rendering
            if (_scaleY < 0) {
                spriteCoord.y = ssY - 1 - spriteCoord.y;
            }
            
            if (_scaleX < 0) {
                spriteCoord.x = ssX - 1 - spriteCoord.x;
            }
            
            return getSpritePixelColor(sprite, spriteCoord);
        }
    }

    // Out of bounds or no sprite
    return undefined;
}


function getMapPixelColorByDrawCoord(map, drawCoord, z, replacementArray) {
    if (! map.spritesheetTable) { throw new Error('The first argument to getMapPixelColorByDrawCoord() must be a map'); }
    const layer = (((z || 0) - _offsetZ) / _scaleZ - map.zOffset) / map.zScale;
    return getMapPixelColor(map, transformDrawToMap(map, drawCoord), layer, replacementArray);
}

    
function getMapSprite(map, mapCoord, layer, replacementArray) {
    if (! map.spritesheetTable) { throw new Error('The first argument to getMapSprite() must be a map'); }
    layer = Math.round(layer || 0) | 0;
    let mx = Math.floor(mapCoord.x);
    let my = Math.floor(mapCoord.y);

    if (map.wrapX) { mx = loop(mx, map.size.x); }
    if (map.wrapY) { my = loop(my, map.size.y); }
    
    if ((layer >= 0) && (layer < map.layer.length) &&
        (mx >= 0) && (my >= 0) &&
        (mx < map.size.x) && (my < map.size.y)) {
        // In bounds
        let sprite = map.layer[layer][mx][my];
        if (replacementArray) {
            for (let i = 0; i < replacementArray.length; i += 2) {
                if (replacementArray[i] === sprite) {
                    return replacementArray[i + 1];
                    break;
                }
            }
        }

        return sprite;

    } else {
        return undefined;
    }
}


function setMapSprite(map, mapCoord, sprite, layer) {
    layer = Math.round(layer || 0) | 0;
    let mx = Math.floor(mapCoord.x);
    let my = Math.floor(mapCoord.y);

    if (map.wrapX) { mx = loop(mx, map.size.x); }
    if (map.wrapY) { my = loop(my, map.size.y); }

    if ((layer >= 0) && (layer < map.layer.length) &&
        (mx >= 0) && (my >= 0) &&
        (mx < map.size.x) && (my < map.size.y)) {
        // In bounds
        map.layer[layer][mx][my] = sprite;
    } else {
        return undefined;
    }
}


function getMapSpriteByDrawCoord(map, drawCoord, z, replacementArray) {
    const layer = ((z || 0) - _offsetZ) / (_scaleZ * map.zScale);
    return getMapSprite(map, transformDrawToMap(map, drawCoord), layer, replacementArray);
}


function setMapSpriteByDrawCoord(map, drawCoord, sprite, z) {
    const layer = ((z || 0) - _offsetZ) / (_scaleZ * map.zScale);
    return setMapSprite(map, transformDrawToMap(map, drawCoord), sprite, layer);
}


function drawMap(map, minLayer, maxLayer, replacements) {
    if (minLayer === undefined) {
        minLayer = 0;
    }

    if (maxLayer === undefined) {
        maxLayer = map.layer.length - 1;
    }

    if (replacements !== undefined) {
        if (! Array.isArray(replacements)) { throw new Error('The replacements for drawMap() must be an array'); }
        if (replacements.length & 1 !== 0) { throw new Error('There must be an even number of elements in the replacements array'); }
        // Convert to a map for efficiency (we need to copy anyway)
        let array = replacements;
        replacements = new Map();
        const N = array.length;
        for (let i = 0; i < N; i += 2) {
            replacements.set(array[i], array[i + 1]);
        }
    }

    // Handle map wrapping
    const oldOffsetX = _offsetX, oldOffsetY = _offsetY;
    for (let shiftY = -1; shiftY <= +1; ++shiftY) {
        if (! map.wrapY && shiftY !== 0) { continue; }
        _offsetY = oldOffsetY + map.size.y * map.spriteSize.y * shiftY;
            
        for (let shiftX = -1; shiftX <= +1; ++shiftX) {
            if (! map.wrapX && shiftX !== 0) { continue; }
            _offsetX = oldOffsetX + map.size.x * map.spriteSize.x * shiftX;
            
            // Compute the setClip coordinates in map coordinates

            // Take the screen-space setClip coordinates to draw coords, and then
            // compute the min/max map coords in pixel space.
            const setClip1 = xy((_clipX1 - _offsetX) / _scaleX, (_clipY1 - _offsetY) / _scaleY);
            const setClip2 = xy((_clipX2 - _offsetX) / _scaleX, (_clipY2 - _offsetY) / _scaleY);

            let mapX1, mapX2, mapY1, mapY2;
            {
                const temp1 = transformDrawToMap(map, setClip1), temp2 = transformDrawToMap(map, setClip2);
                mapX1 = Math.floor(Math.min(temp1.x, temp2.x));
                mapX2 = Math.ceil (Math.max(temp1.x, temp2.x));
                
                mapY1 = Math.floor(Math.min(temp1.y, temp2.y));
                mapY2 = Math.ceil (Math.max(temp1.y, temp2.y));

                mapX1 = Math.max(mapX1, 0);
                mapX2 = Math.min(mapX2, map.size.x - 1);
                
                mapY1 = Math.max(mapY1, 0);
                mapY2 = Math.min(mapY2, map.size.y - 1);
            }

            // Submit the sprite calls. We pack them together into big layer
            // calls to reduce sorting, but since the map is mutable we have to actually
            // copy all elements for those calls.

            for (let L = minLayer; L <= maxLayer; ++L) {
                const layer = map.layer[L];
                const z = transformMapLayerToDrawZ(L) * _scaleZ + _offsetZ;
                
                const layerData = [];
                
                for (let mapX = mapX1; mapX <= mapX2; ++mapX) {
                    const column = layer[mapX];
                    for (let mapY = mapY1; mapY <= mapY2; ++mapY) {
                        let sprite = column[mapY];
                        if (sprite !== undefined) {
                            
                            if (replacements && replacements.has(sprite)) {
                                // Perform replacement
                                sprite = replacements.get(sprite);
                                
                                // Which may be empty
                                if (sprite === undefined) { continue; }
                            }
                            
                            // Compute the screen (not draw)
                            // coordinates. Sprites are rendered from centers,
                            // so offset each by 1/2 the tile size.
                            layerData.push({sprite: sprite,
                                            x: ((mapX + 0.5) * map.spriteSize.x + map._offset.x) * _scaleX + _offsetX,
                                            y: ((mapY + 0.5) * map.spriteSize.y + map._offset.y) * _scaleY + _offsetY})
                        }
                    } // y
                } // x

                if (layerData.length > 0) {
                    _addGraphicsCommand({
                        opcode: 'MAP',
                        z: (L * map.zScale + map.zOffset) * _scaleZ + _offsetZ,
                        layerData: layerData
                    });
                }
            } // L
        } // wrapX
    } // wrapY

    _offsetX = oldOffsetX;
    _offsetY = oldOffsetY;
}


function drawTri(A, B, C, color, outline, z) {
    z = z || 0
    const skx = z * _skewXZ, sky = z * _skewYZ;
    
    let Ax = (A.x + skx) * _scaleX + _offsetX, Ay = (A.y + sky) * _scaleY + _offsetY;
    let Bx = (B.x + skx) * _scaleX + _offsetX, By = (B.y + sky) * _scaleY + _offsetY;
    let Cx = (C.x + skx) * _scaleX + _offsetX, Cy = (C.y + sky) * _scaleY + _offsetY;

    z = z * _scaleZ + _offsetZ;
    
    // Extract the fill color, which is not yet used in this implementation
    color   = _colorToUint32(color);
    outline = _colorToUint32(outline);

    // Culling/all transparent optimization
    if ((Math.min(Ax, Bx, Cx) > _clipX2 + 0.5) || (Math.min(Ay, By, Cy) > _clipY2 + 0.5) || (z < _clipZ1 - 0.5) ||
        (Math.max(Ax, Bx, Cx) < _clipX1 - 0.5) || (Math.max(Ay, By, Cy) < _clipY1 - 0.5) || (z > _clipZ2 + 0.5) ||
        !((color | outline) & 0xff000000)) {
        return;
    }

    _addGraphicsCommand({
        opcode: 'TRI',
        Ax: Ax,
        Ay: Ay,
        Bx: Bx,
        By: By,
        Cx: Cx,
        Cy: Cy,
        z: z,
        color: color,
        outline: outline
    });
}


function drawDisk(center, radius, color, outline, z) {
    z = z || 0;
    const skx = (z * _skewXZ), sky = (z * _skewYZ);
    let x = (center.x + skx) * _scaleX + _offsetX, y = (center.y + sky) * _scaleY + _offsetY;
    z = z * _scaleZ + _offsetZ;
    
    radius = (radius + 0.5) | 0;

    // Culling optimization
    if ((x - radius > _clipX2 + 0.5) || (y - radius > _clipY2 + 0.5) || (z > _clipZ2 + 0.5) ||
        (x + radius < _clipX1 - 0.5) || (y + radius < _clipY1 - 0.5) || (z < _clipZ1 - 0.5)) {
        return;
    }

    color   = _colorToUint32(color);
    outline = _colorToUint32(outline);

    _addGraphicsCommand({
        opcode: 'CIR',
        x: x,
        y: y,
        z: z,
        radius: radius,
        color: color,
        outline: outline
    });
}


function _colorToUint32(color) {
    if (color === undefined) { return 0; }
    
    const a = color.a;
    
    let c = 0x0F000000 >>> 0;
    if (a !== undefined) {
        // >>> 0 ensures uint32
        c = (((a * 15 + 0.5) & 0xf) << 24) >>> 0;
    }

    let r = color.r, g = color.g, b = color.b, h = color.h;

    if (h !== undefined) {
        let s = _clamp(color.s, 0, 1), v = _clamp(color.v, 0, 1);

        // Convert to RGB
        r = v * (1 - s + s * _clamp(Math.abs(_fract(h + 1.0) * 6 - 3) - 1, 0, 1));
        g = v * (1 - s + s * _clamp(Math.abs(_fract(h + 2/3) * 6 - 3) - 1, 0, 1));
        b = v * (1 - s + s * _clamp(Math.abs(_fract(h + 1/3) * 6 - 3) - 1, 0, 1));
    }

    if (r !== undefined) {
        c = (c | ((b * 15 + 0.5) << 16) | ((g * 15 + 0.5) << 8) | (r * 15 + 0.5)) >>> 0;
    } else {
        return 0xFFFFFFFF >>> 0;
    }

    // Set high bits, keeping everything in uint32
    return (c | (c << 4)) >>> 0;
}


function drawRect(corner, size, fill, outline, z) {
    z = z || 0;
    const skx = (z * _skewXZ), sky = (z * _skewYZ);
    let x1 = (corner.x + skx) * _scaleX + _offsetX, y1 = (corner.y + sky) * _scaleY + _offsetY;
    let x2 = (corner.x + size.x + skx) * _scaleX + _offsetX, y2 = (corner.y + size.y + sky) * _scaleY + _offsetY;
    z = z * _scaleZ + _offsetZ;

    fill = _colorToUint32(fill);
    outline = _colorToUint32(outline);

    // Sort coordinates
    let t1 = Math.min(x1, x2), t2 = Math.max(x1, x2);
    x1 = t1; x2 = t2;
    
    t1 = Math.min(y1, y2), t2 = Math.max(y1, y2);
    y1 = t1; y2 = t2;

    // Inclusive bounds for open top and left edges at the pixel center samples
    // low 0 -> 0, 0.5 -> 1
    // high 4 -> 3, 4.5 -> 4
    x1 = Math.round(x1); y1 = Math.round(y1);
    x2 = Math.floor(x2 - 0.5); y2 = Math.floor(y2 - 0.5);

    // Culling optimization
    if ((x2 < x1) || (y2 < y1) ||
        (x1 > _clipX2 + 0.5) || (x2 < _clipX1 - 0.5) || (z < _clipZ1 - 0.5) ||
        (y1 > _clipY2 + 0.5) || (y2 < _clipY1 - 0.5) || (z > _clipZ2 + 0.5)) {
        return;
    }

    _addGraphicsCommand({
        z: z,
        opcode: 'REC',
        x1: x1,
        y1: y1,
        x2: x2,
        y2: y2,
        fill: fill,
        outline: outline
    });
}


function drawLine(A, B, color, z) {
    z = z || 0;
    const skx = (z * _skewXZ), sky = (z * _skewYZ);
    let x1 = (A.x + skx) * _scaleX + _offsetX, y1 = (A.y + sky) * _scaleY + _offsetY;
    let x2 = (B.x + skx) * _scaleX + _offsetX, y2 = (B.y + sky) * _scaleY + _offsetY;
    z = z * _scaleZ + _offsetZ

    color = _colorToUint32(color);

    // Offscreen culling optimization
    if (! (color & 0xff000000) ||
        (Math.min(x1, x2) > _clipX2 + 0.5) || (Math.max(x1, x2) < _clipX1 - 0.5) || (z < _clipZ1 - 0.5) ||
        (Math.min(y1, y2) > _clipY2 + 0.5) || (Math.max(y1, y2) < _clipY1 - 0.5) || (z > _clipZ2 + 0.5)) {
        return;
    }

    _addGraphicsCommand({
        opcode: 'LIN',
        x1: x1,
        x2: x2,
        y1: y1,
        y2: y2,
        z: z,
        color: color        
    });
}


function drawPoint(P, color, z) {
    z = z || 0;
    const skx = (z * _skewXZ), sky = (z * _skewYZ);
    let x = (P.x + skx) * _scaleX + _offsetX, y = (P.y + sky) * _scaleY + _offsetY;
    z = z * _scaleZ + _offsetZ;

    x = Math.floor(x); y = Math.floor(y);
    
    if ((z < _clipZ1 - 0.5) || (z >= _clipZ2 + 0.5) ||
        (x < _clipX1) || (x > _clipX2) ||
        (y < _clipY1) || (y > _clipY2)) {
        return;
    }

    const prevCommand = _graphicsCommandList[_graphicsCommandList.length - 1];
    if (prevCommand && (prevCommand.baseZ === z) && (prevCommand.opcode === 'PIX')) {
        // Many points with the same z value are often drawn right
        // after each other.  Aggregate these (preserving their
        // ordering) for faster sorting and rendering.
        prevCommand.data.push(x >>> 0, y >>> 0, _colorToUint32(color));        
    } else {
        _addGraphicsCommand({
            z: z,
            baseZ: z,
            opcode: 'PIX',
            data: [x >>> 0, y >>> 0, _colorToUint32(color)]});
    }
}


function textWidth(font, str) {
    if (str === '') { return 0; }

    // Don't add space after the last letter
    let width = -font._spacing.x;
    
    // Add the variable widths of the letters. Don't count the border
    // against the letter width.
    for (let c = 0; c < str.length; ++c) {
        const chr = _fontMap[str[c]] || ' ';
        const bounds = font._bounds[chr];
        width += (bounds.x2 - bounds.x1 + 1) + font._spacing.x - font._borderSize * 2 + bounds.pre + bounds.post;
    }

    return width;    
}


function drawText(font, str, P, color, shadow, outline, xAlign, yAlign, z, wrapWidth) {
    if (font && font.font) {
        // Keyword version
        wrapWidth = font.wrapWidth;
        z = font.z;
        yAlign = font.yAlign;
        xAlign = font.xAlign;
        outline = font.outline;
        shadow = font.shadow;
        color = font.color;
        P = font.pos;
        str = font.text;
        font = font.font;
    }

    if (typeof str !== 'string') {
        str = unparse(str);
    }
    
    if (str === '') { return {x:0, y:0}; }

    // Add the variable widths of the letters to compute the
    // width. Don't count the border against the letter width.
    let width = 0;
    for (let c = 0; c < str.length; ++c) {
        const chr = _fontMap[str[c]] || ' ';

        if (str[c] === '\n') {
            // Newline, process by breaking and recursively continuing
            const firstLineBounds = drawText(font, str.substring(0, c).trimEnd(), P, color, shadow, outline, xAlign, yAlign, z);
            const restBounds = drawText(font, str.substring(c + 1), xy(P.x, P.y + font.lineHeight / _scaleY), color, shadow, outline, xAlign, yAlign, z, wrapWidth);
            firstLineBounds.x = Math.max(firstLineBounds.x, restBounds.x);
            firstLineBounds.y += restBounds.y + font.lineHeight + font._spacing.y;
            return firstLineBounds;
        }
        
        const bounds = font._bounds[chr];
        
        width += (bounds.x2 - bounds.x1 + 1) + font._spacing.x - font._borderSize * 2 + bounds.pre + bounds.post;

        // Word wrapping
        if ((wrapWidth > 0) && (width > wrapWidth - font._spacing.x)) {
            // Perform word wrap, we've exceeded the available width
            // Search backwards for a place to break.
            const breakChars = ' \n\t,.!:/\\)]}\'"|`-+=*';

            // Avoid breaking more than halfway back along the string
            const maxBreakSearch = Math.max(1, (c * 0.5) | 0);
            let breakIndex = -1;
            for (let i = 0; (breakIndex < maxBreakSearch) && (i < breakChars.length); ++i) {
                breakIndex = Math.max(breakIndex, str.lastIndexOf(breakChars[i], c));
            }
            
            if ((breakIndex > c) || (breakIndex < maxBreakSearch)) {
                // Give up and break at c
                breakIndex = c;
            }
            
            const firstLineBounds = drawText(font, str.substring(0, breakIndex).trimEnd(), P, color, shadow, outline, xAlign, yAlign, z);
            
            // Now draw the rest
            const restBounds = drawText(font, str.substring(breakIndex).trimStart(), xy(P.x, P.y + font.lineHeight / _scaleY), color, shadow, outline, xAlign, yAlign, z, wrapWidth);
            firstLineBounds.x = Math.max(firstLineBounds.x, restBounds.x);
            firstLineBounds.y += restBounds.y + font.lineHeight + font._spacing.y;
            return firstLineBounds;
        }
    }

    // Don't add space after the last letter
    width -= font._spacing.x;
    
    z = z || 0;
    const skx = (z * _skewXZ), sky = (z * _skewYZ);
    let x = (P.x + skx) * _scaleX + _offsetX, y = (P.y + sky) * _scaleY + _offsetY;
    z = z * _scaleZ + _offsetZ;
    
    color   = _colorToUint32(color);
    shadow  = _colorToUint32(shadow);
    outline = _colorToUint32(outline);

    let height = font._charHeight;

    switch (xAlign) {
    case undefined: case 'left': xAlign = -1; break;
    case 'middle': case 'center': xAlign = 0; break;
    case 'right':  xAlign = +1; break;
    }

    switch (yAlign) {
    case 'top': yAlign = -1; break;
    case 'center': case 'middle': yAlign = 0; break;
    case undefined: case 'baseline': yAlign = +1; break;
    case 'bottom': yAlign = +2; break;
    }

    // Force alignment to retain relative integer pixel alignment
    x -= Math.round(width * (1 + xAlign) * 0.5);

    // Move back to account for the border and shadow padding
    if (xAlign !== +1) { --x; }

    switch (yAlign) {
    case -1: y -= font._borderSize; break; // Align to the top of the bounds
    case  0:
        // Middle. Center on a '2', which tends to have a typical height 
        const bounds = font._bounds['2'];
        const tileY = Math.floor(bounds.y1 / font._charHeight) * font._charHeight;
        y -= Math.round((bounds.y1 + bounds.y2) / 2) - tileY;
        break;
    case  1: y -= font._baseline; break; // baseline
    case  2: y -= (font._charHeight - font._borderSize * 2 - font._shadowSize); break; // bottom of bounds
    }

    // Center and round. Have to call round() because values may
    // be negative
    x = Math.round(x) | 0;
    y = Math.round(y) | 0;

    if ((x > _clipX2) || (y > _clipY2) || (y + height < _clipY1) || (x + width < _clipX1) ||
        (z > _clipZ2 + 0.5) || (z < _clipZ1 - 0.5)) {
        // Cull when off-screen
    } else {
        _addGraphicsCommand({
            opcode: 'TXT',
            str: str,
            font: font,
            x: x,
            y: y,
            z: z,
            color:   color,
            outline: outline,
            shadow:  shadow,
            height:  height,
            width:   width,
        });
    }

    return {x:width, y:font.lineHeight + font._spacing.y};
}


/* Returns a shallow copy */
function _clone(a) {
    if (a instanceof Array) {
        return a.slice();
    } else if (typeof a === 'Object') {
        return Object.assign({}, a);
    } else {
        return a;
    }
}


function _clamp(x, L, H) {
    return Math.max(Math.min(x, H), L);
}


function getSpritePixelColor(spr, pos) {
    if (! (spr && spr.spritesheet)) {
        throw new Error('Called getSpritePixelColor() on an object that was not a sprite asset. (' + unparse(spr) + ')');
    }

    const x = Math.floor((spr.scale.x > 0) ? pos.x : (spr.size.x - 1 - pos.x));
    const y = Math.floor((spr.scale.y > 0) ? pos.y : (spr.size.y - 1 - pos.y));
    
    if ((x < 0) || (x >= spr.size.x) || (y < 0) || (y >= spr.size.y)) {
        return undefined;
    } else {
        const sheet = spr.spritesheet;
        const pixel = sheet._uint32Data[(spr._x + x) + (spr._y + y) * sheet._uint32Data.width];
        const a = ((pixel >>> 28) & 0xf) * (1 / 15);
        const b = ((pixel >>> 20) & 0xf) * (1 / 15);
        const g = ((pixel >>> 12) & 0xf) * (1 / 15);
        const r = ((pixel >>>  4) & 0xf) * (1 / 15);
        return {r:r, g:g, b:b, a:a};
    }
}


function drawSpriteRect(CC, corner, size, z) {
    if (! (CC && CC.spritesheet)) {
        throw new Error('Called drawSpriteRect() on an object that was not a sprite asset. (' + unparse(CC) + ')');
    }
    z = z || 0;
    const skx = (z * _skewXZ), sky = (z * _skewYZ);
    let x1 = (corner.x + skx) * _scaleX + _offsetX, y1 = (corner.y + sky) * _scaleY + _offsetY;
    let x2 = (corner.x + size.x + skx) * _scaleX + _offsetX, y2 = (corner.y + size.y + sky) * _scaleY + _offsetY;
    z = z * _scaleZ + _offsetZ;

    // Sort coordinates
    let t1 = Math.min(x1, x2), t2 = Math.max(x1, x2);
    x1 = t1; x2 = t2;
    
    t1 = Math.min(y1, y2), t2 = Math.max(y1, y2);
    y1 = t1; y2 = t2;

    // Lock to the pixel grid before computing offsets
    x1 = Math.round(x1); y1 = Math.round(y1);
    x2 = Math.floor(x2 - 0.5); y2 = Math.floor(y2 - 0.5);
    
    const centerX = (x2 + x1) / 2, centerY = (y2 + y1) / 2;

    // We always put a tile in the center, so the width is based on
    // the ceiling of the *half* width, not the full width. Note the
    // the number of tiles in each direction is therefore guaranteed
    // to be odd.
    const numTilesX = 1 + Math.ceil((x2 - x1 + 1) / (2 * CC.size.x) - 0.49) * 2;
    const numTilesY = 1 + Math.ceil((y2 - y1 + 1) / (2 * CC.size.y) - 0.49) * 2;
    
    // Iterate over center box, clipping at its edges
    const spriteCenter = xy(0,0);
    _pushGraphicsState(); {
        intersectClip(x1, y1, undefined,
                      x2 - x1 + 1.5, y2 - y1 + 1.5, undefined);
        
        for (let y = 0; y < numTilesY; ++y) {
            // Transform individual pixel coordinates *back* to game
            // coords for the drawSprite call to handle clipping and
            // insertion into the queue.
            spriteCenter.y = ((centerY + (y - (numTilesY - 1) * 0.5) * CC.size.y) - _offsetY) / _scaleY;
            for (let x = 0; x < numTilesX; ++x) {
                spriteCenter.x = ((centerX + (x - (numTilesX - 1) * 0.5) * CC.size.x) - _offsetX) / _scaleX;
                drawSprite(CC, spriteCenter, 0, undefined, 1, z);
            }
        }
    } _popGraphicsState();
    
    // Generate relative sprites
    const LT = CC.spritesheet[Math.max(0, CC._tileX - 1)][Math.max(0, CC._tileY - 1)];
    const CT = CC.spritesheet[Math.max(0, CC._tileX    )][Math.max(0, CC._tileY - 1)];
    const RT = CC.spritesheet[Math.max(0, CC._tileX + 1)][Math.max(0, CC._tileY - 1)];

    const LC = CC.spritesheet[Math.max(0, CC._tileX - 1)][Math.max(0, CC._tileY    )];
    const RC = CC.spritesheet[Math.max(0, CC._tileX + 1)][Math.max(0, CC._tileY    )];

    const LB = CC.spritesheet[Math.max(0, CC._tileX - 1)][Math.max(0, CC._tileY + 1)];
    const CB = CC.spritesheet[Math.max(0, CC._tileX    )][Math.max(0, CC._tileY + 1)];
    const RB = CC.spritesheet[Math.max(0, CC._tileX + 1)][Math.max(0, CC._tileY + 1)];

    // Centers of the sprites on these edges
    const left   = ((x1 - CC.size.x * 0.5) - _offsetX) / _scaleX - 0.5;
    const right  = ((x2 + CC.size.x * 0.5) - _offsetX) / _scaleX + 1;
    const top    = ((y1 - CC.size.y * 0.5) - _offsetY) / _scaleY - 0.5;
    const bottom = ((y2 + CC.size.y * 0.5) - _offsetY) / _scaleY + 1;
    
    // Top and bottom
    _pushGraphicsState(); {
        intersectClip(x1, undefined, undefined,
                      x2 - x1 + 1.5, undefined, undefined);
        
        for (let x = 0; x < numTilesX; ++x) {
            spriteCenter.x = ((centerX + (x - (numTilesX - 1) * 0.5) * CC.size.x) - _offsetX) / _scaleX;

            spriteCenter.y = top;
            drawSprite(CT, spriteCenter, 0, undefined, 1, z);
            
            spriteCenter.y = bottom;
            drawSprite(CB, spriteCenter, 0, undefined, 1, z);
        }
    } _popGraphicsState();

    // Sides
    _pushGraphicsState(); {
        intersectClip(undefined, y1, undefined,
                      undefined, y2 - y1 + 1.5, undefined);
        
        for (let y = 0; y < numTilesY; ++y) {
            spriteCenter.y = ((centerY + (y - (numTilesY - 1) * 0.5) * CC.size.y) - _offsetY) / _scaleY;

            spriteCenter.x = left;
            drawSprite(LC, spriteCenter, 0, undefined, 1, z);
            
            spriteCenter.x = right;
            drawSprite(RC, spriteCenter, 0, undefined, 1, z);
        }
    } _popGraphicsState();

    // Corners (no new clipping needed)
    {
        // Left Top
        spriteCenter.x = left; spriteCenter.y = top;
        drawSprite(LT, spriteCenter, 0, undefined, 1, z);
        
        // Right Top
        spriteCenter.x = right;
        drawSprite(RT, spriteCenter, 0, undefined, 1, z);

        // Left Bottom
        spriteCenter.x = left; spriteCenter.y = bottom;
        drawSprite(LB, spriteCenter, 0, undefined, 1, z);

        // Right Bottom
        spriteCenter.x = right;
        drawSprite(RB, spriteCenter, 0, undefined, 1, z);
    }
}


function drawSprite(spr, center, angle, scale, opacity, z, overrideColor) {
    if (spr && spr.sprite) {
        // This is the "keyword" version of the function
        z = spr.z;
        opacity = spr.opacity;
        scale = spr.scale;
        angle = spr.angle;
        center = spr.pos;
        overrideColor = spr.overrideColor;
        spr = spr.sprite;
    }

    if (Array.isArray(spr) && spr.spriteSize && Array.isArray(spr[0])) {
        // The sprite was a spritesheet. Grab the first element
        spr = spr[0][0];
    }

    if (! (spr && spr.spritesheet)) {
        throw new Error('Called drawSprite() on an object that was not a sprite asset. (' + unparse(spr) + ')');
    }
    
    z = z || 0;

    const skx = (z * _skewXZ), sky = (z * _skewYZ);
    const x = (center.x + skx) * _scaleX + _offsetX;
    const y = (center.y + sky) * _scaleY + _offsetY;
    z = z * _scaleZ + _offsetZ;

    let scaleX = 1, scaleY = 1;
    if ((scale !== 0) && (typeof scale === 'number')) {
        scaleX = scaleY = scale;
    } if (scale && scale.x && scale.y) {
        scaleX = scale.x;
        scaleY = scale.y;
    }
    
    // Apply the sprite's own flipping
    scaleX *= spr.scale.x; scaleY *= spr.scale.y;
    
    opacity = Math.max(0, Math.min(1, opacity || 1));
    const radius = spr._boundingRadius * Math.max(Math.abs(scaleX), Math.abs(scaleY));

    if ((opacity <= 0) || (x + radius < _clipX1 - 0.5) || (y + radius < _clipY1 - 0.5) ||
        (x >= _clipX2 + radius + 0.5) || (y >= _clipY2 + radius + 0.5) ||
        (z < _clipZ1 - 0.5) || (z >= _clipZ2 + 0.5)) {
        return;
    }

    // Don't use getRotationSign() on the angle, because the angle
    // WILL be interpreted as CCW when the queued command actually
    // executes.

    if (overrideColor) {
        // have to clone and convert to RGB space
        overrideColor = rgba(overrideColor);
    }    

    _addGraphicsCommand({
        opcode: 'BLT',
        sprite: spr,
        angle: (angle || 0),
        scaleX: scaleX,
        scaleY: scaleY,
        opacity: opacity,
        overrideColor: overrideColor,
        x: x,
        y: y,
        z: z,
    });
}


// Can't be implemented as min(loop(x,k), k - loop(x,k)) because
// that doesn't handle fractional values in the desired way.
function oscillate(x, hi) {
    hi = hi || 1;
    const k = 2 * hi;
    x = loop(x, k);
    return (x < hi) ? x : k - x;
}


function clamp(x, lo, hi) {
    return min(max(x, lo), hi);
}

function loop(x, hi) {
    hi = Math.abs(hi || 1);
    return x - Math.floor(x / hi) * hi;
}


function setBackground(c) {
    if (Array.isArray(c) && c.spriteSize && Array.isArray(c[0])) {
        // c was a sprite sheet
        c = c[0][0];
    }

    if (c.spritesheet && (c.spritesheet.size.x !== _SCREEN_WIDTH || c.spritesheet.size.y !== _SCREEN_HEIGHT ||
                          c.size.x !== _SCREEN_WIDTH || c.size.y !== _SCREEN_HEIGHT)) {
        throw new Error('The sprite and its spritesheet for setBackground() must be exactly the screen size.')
    }
    
    _background = c;
}


// Transform v into the reference frame of entity
function _toFrame(entity, v, out) {
    // Translate
    const x = v.x - entity.pos.x;
    const y = v.y - entity.pos.y;
    
    // Rotate
    let c = Math.cos(entity.angle * getRotationSign());
    let s = Math.sin(entity.angle * getRotationSign());
    
    if (out === undefined) { out = {x:0, y:0}; }
    
    out.x = x * c + y * s;
    out.y = y * c - x * s;
    
    return out;
}


function drawBounds(entity, color, recurse) {
    if (! entity.pos) {
        throw new Error('drawEntityBounds() must be called on an object with at least a pos property');
    }
    
    if (recurse === undefined) { recurse = true; }
    color = color || rgb(0.6, 0.6, 0.6);
    const angle = (entity.angle || 0) * getRotationSign();
    const scale = entity.scale || {x:1, y:1};

    // Bounds:
    const z = entity.z + 0.01;
    if ((entity.shape === 'disk') && entity.size) {
        drawDisk(entity.pos, entity.size.x * 0.5 * Math.hypot(scale.x, scale.y), undefined, color, z)
    } else if (entity.size) {
        const u = {x: Math.cos(angle) * 0.5, y: Math.sin(angle) * 0.5};
        const v = {x: -u.y, y: u.x};
        u.x *= entity.size.x * scale.x; u.y *= entity.size.x * scale.x;
        v.x *= entity.size.y * scale.y; v.y *= entity.size.y * scale.y;

        const A = {x: entity.pos.x - u.x - v.x, y: entity.pos.y - u.y - v.y};
        const B = {x: entity.pos.x + u.x - v.x, y: entity.pos.y + u.y - v.y};
        const C = {x: entity.pos.x + u.x + v.x, y: entity.pos.y + u.y + v.y};
        const D = {x: entity.pos.x - u.x + v.x, y: entity.pos.y - u.y + v.y};
        drawLine(A, B, color, z);
        drawLine(B, C, color, z);
        drawLine(C, D, color, z);
        drawLine(D, A, color, z);
    } else {
        drawPoint(entity.pos, color, z);
    }

    // Axes
    {
        const u = {x: Math.cos(angle) * 16, y: Math.sin(angle) * 16};
        const v = {x: -u.y, y: u.x};
        u.x *= scale.x; u.y *= scale.x;
        v.x *= scale.y; v.y *= scale.y;
        
        const B = {x: entity.pos.x + u.x, y: entity.pos.y + u.y};
        const C = {x: entity.pos.x + v.x, y: entity.pos.y + v.y};
        
        drawLine(entity.pos, B, rgb(1,0,0), z);
        drawLine(entity.pos, C, rgb(0,1,0), z);
    }

    if (entity.childArray && recurse) {
        for (let i = 0; i < entity.childArray; ++i) {
            debugDrawEntity(entity.childArray[c], color, recurse);
        }
    }
}

function _getAABB(e, aabb) {
    // Take the bounds to draw space
    let w = (e.scale ? e.scale.x : 1) * e.size.x;
    let h = (e.scale ? e.scale.y : 1) * e.size.y;
    if ((e.shape !== 'disk') && (e.angle !== undefined)) {
        const c = Math.abs(Math.cos(e.angle));
        const s = Math.abs(Math.sin(e.angle));
        const x = w * c + h * s;
        const y = h * c + w * s;
        w = x; h = y;
    }
    w *= 0.5;
    h *= 0.5;
    aabb.max.x = Math.max(aabb.max.x, e.pos.x + w);
    aabb.min.x = Math.min(aabb.min.x, e.pos.x - w);
    aabb.max.y = Math.max(aabb.max.y, e.pos.y + h);
    aabb.min.y = Math.min(aabb.min.y, e.pos.x - h);

    // Recurse
    if (e.childArray) {
        for (let i = 0; i < e.childArray.length; ++i) {
            _getAABB(e.childArray[i], aabb);
        }
    }
}


function axisAlignedDrawBox(e) {
    const aabb = {max: xy(-Infinity, -Infinity),
                  min: xy( Infinity,  Infinity)};
    _getAABB(e, aabb);
    return {pos: xy((aabb.max.x + aabb.min.x) * 0.5,
                    (aabb.max.y + aabb.min.y) * 0.5),
            shape: 'rect',
            scale: xy(1, 1),
            angle: 0,
            size: xy(aabb.max.x - aabb.min.x,
                     aabb.max.y - aabb.min.y)};            
}


function rayIntersect(ray, obj) {
    let hitObj = undefined;
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; ++i) {
            hitObj = rayIntersect(ray, obj[i]) || hitObj;
        }
        return hitObj;
    }

    // Default to an infinite ray
    if (ray.length === undefined) {
        ray.length = Infinity;
    }

    let scaleX = obj.scale ? obj.scale.x : 1;
    let scaleY = obj.scale ? obj.scale.y : 1;
    
    if (obj.size) {
        // Normalize the direction
        let inv = 1 / Math.hypot(ray.direction.x, ray.direction.y);
        ray.direction.x *= inv; ray.direction.y *= inv;
        
        if (obj.shape === 'disk') {
            // ray-disk (https://www.geometrictools.com/Documentation/IntersectionLine2Circle2.pdf)
            let dx = ray.origin.x - obj.pos.x, dy = ray.origin.y - obj.pos.y;
            if (dx * dx + dy * dy * 4 <= Math.abs(obj.size.x * obj.size.y * scaleX * scaleY)) {
                // Origin is inside the disk, so instant hit and no need
                // to look at children
                ray.length = 0;
                return obj;
            } else {
                // Origin is outside of the disk.
                const b = ray.direction.x * dx + ray.direction.y * dy
                const discrim = b*b - (dx*dx + dy*dy - 0.25 * obj.size.x * obj.size.y * scaleX * scaleY);
                if (discrim >= 0) {
                    const a = Math.sqrt(discrim);
                    
                    // Start with the smaller root
                    let t = -b - a;
                    if (t < 0) {
                        // Try the larger root
                        t = -b + a;
                    }
                    
                    if ((t >= 0) && (t < ray.length)) {
                        hitObj = obj;
                        ray.length = t;
                    }
                }            
            }
        } else {
            // Move to the box's translational frame
            let toriginX = ray.origin.x - obj.pos.x;
            let toriginY = ray.origin.y - obj.pos.y;
            
            // Take the ray into the box's rotational frame
            const angle = (obj.angle || 0) * getRotationSign();
            const c = Math.cos(angle), s = Math.sin(angle);

            const originX = toriginX * c + toriginY * s;
            const originY =-toriginX * s + toriginY * c;

            const directionX = ray.direction.x * c + ray.direction.y * s;
            const directionY =-ray.direction.x * s + ray.direction.y * c;

            const radX = obj.size.x * 0.5 * scaleX;
            const radY = obj.size.y * 0.5 * scaleY;

            // Perform ray vs. oriented box intersection
            // (http://jcgt.org/published/0007/03/04/)

            const winding = (Math.max(abs(originX / radX),
                                      abs(originY / radY)) < 1.0) ? -1 : 1;

            const sgnX = -Math.sign(directionX);
            const sgnY = -Math.sign(directionY);
            
            // Distance to edge lines
            const dX = (radX * winding * sgnX - originX) / directionX;
            const dY = (radY * winding * sgnY - originY) / directionY;

            const testX = (dX >= 0) && (Math.abs(originY + directionY * dX) < radY);
            const testY = (dY >= 0) && (Math.abs(originX + directionX * dY) < radX);

            if (testX) {
                if (dX < ray.length) {
                    ray.length = dX;
                    hitObj = obj;
                }
            } else if (testY && (dY < ray.length)) {
                ray.length = dY;
                hitObj = obj;
            }
        }
    }

    // Test children
    if (obj.childArray) {
        hitObj = rayIntersect(ray, obj.childArray) || hitObj;
    }

    return hitObj;
}


function entityInertia(entity, mass) {
    const scaleX = entity.scale ? entity.scale.x : 1;
    const scaleY = entity.scale ? entity.scale.y : 1;
    
    // Inertia tensor about the center (https://en.wikipedia.org/wiki/List_of_moments_of_inertia)
    // rect: 1/12 * m * (w^2 + h^2)
    // disk: m * (w/2)^2
    if (mass === undefined) { mass = entityMass(entity); }
    
    if (entity.shape == 'rect') {
        return mass * (_square(entity.size.x * scaleX) + _square(entity.size.y * scaleY)) * (1 / 12);
    } else {
        return mass * _square(entity.scale.x * scaleX * 0.5);
    }
}


function entityMass(entity) {
    return entityArea(entity) * ((entity.density !== undefined) ? entity.density : 1);
}


function entityArea(entity) {
    const scaleX = entity.scale ? entity.scale.x : 1;
    const scaleY = entity.scale ? entity.scale.y : 1;

    if (entity.size === undefined) {
        return 0;
    } else if (entity.shape === 'disk') {
        return Math.abs(Math.PI * 0.25 * scaleX * scaleY * entity.size.x * entity.size.y);
    } else {
        return Math.abs(scaleX * scaleY * entity.size.x * entity.size.y);
    }
}

/** True if the objects overlap. Positions are centers. Sizes are
    width, height vectors.  Angles are counter-clockwise radians from
    +x to +y. Shapes are 'rect' or 'disk'. If 'disk', the size x
    and y must be the same.  */
var overlaps = (function() {

    // Appends e and all of its descendants to output
    function getDescendants(e, output) {
        if (e) {
            output.push(e);
            if (e.childArray) {
                for (let i = 0; i < e.childArray; ++i) {
                    getDescendants(e.childArray[i], output);
                }
            }
        }
    }
    
    function distanceSquared2D(u, v) { return _square(u.x - v.x) + _square(u.y - v.y); }

    // Scratch space vector to avoid memory allocation
    const temp = {x:0, y:0};
    const temp2 = {x:0, y:0};

    // From http://www.flipcode.com/archives/2D_OBB_Intersection.shtml
    function obbOverlapOneWay(A, B, offsetX, offsetY) {
        // Transform B in to A's reference frame and then use the
        // separating axis test.  Try to find an axis along which
        // the projection of B onto A does not overlap

        temp2.x = B.pos.x - offsetX;
        temp2.y = B.pos.y - offsetY;
        const center = _toFrame(A, temp2, temp);
        const angle  = (B.angle - A.angle) * getRotationSign();

        // Find the extremes of the corners of B along each axis of A
        const c = Math.cos(angle);
        const s = Math.sin(angle);

        let loX =  Infinity, loY =  Infinity;
        var hiX = -Infinity, hiY = -Infinity;

        // Four corners = four combinations of signs. Expand out the
        // vector operations to avoid memory allocation.
        for (let signX = -1; signX <= +1; signX += 2) {
            for (let signY = -1; signY <= +1; signY += 2) {
                const xx = signX * B.size.x * 0.5 * Math.abs(B.scale.x);
                const yy = signY * B.size.y * 0.5 * Math.abs(B.scale.y);
                const cornerX = xx *  c + yy * s;
                const cornerY = xx * -s + yy * c;

                loX = Math.min(loX, cornerX);
                loY = Math.min(loY, cornerY);

                hiX = Math.max(hiX, cornerX);
                hiY = Math.max(hiY, cornerY);
            }
        }

        loX += center.x;
        loY += center.y;
        hiX += center.x;
        hiY += center.y;
        
        // We can now perform an AABB test to see if there is no separating
        // axis under this projection
        return ((loX * 2 <= A.size.x * Math.abs(A.scale.x)) && (hiX * 2 >= -A.size.x * Math.abs(A.scale.x)) &&
                (loY * 2 <= A.size.y * Math.abs(A.scale.y)) && (hiY * 2 >= -A.size.y * Math.abs(A.scale.y)));
    }

    // Add any default fields needed and return the cleaned up object.
    function cleanup(A) {
        if ((A.scale === undefined) || (A.pos === undefined) || (A.shape === undefined) || (A.size === undefined)) {
            if ((A.x !== undefined) && (A.y !== undefined)) {
                // This is a point. Default to disk because it makes
                // collision tests simpler.
                A = {pos:A, shape: 'disk'};
            }
            
            // Make a new object with default properties
            A = Object.assign({scale: xy(1, 1), size: xy(0, 0), angle: 0, shape: 'rect'}, A);
        }

        // All required properties are present
        return A;
    }

    return function(A, B, recurse) {
        if (A === undefined) { throw new Error('First argument to overlaps() must not be nil'); }
        if (B === undefined) { throw new Error('Second argument to overlaps() must not be nil'); }
        
        if (((recurse === undefined) || recurse) &&
            ((A.childArray && (A.childArray.length > 0)) ||
             (B.childArray && (B.childArray.length > 0)))) {
            // Handle all combinations of chidren here
            const AArray = [], BArray = [];
            getDescendants(A, AArray);
            getDescendants(B, BArray);
            for (let i = 0; i < AArray.length; ++i) {
                for (let j = 0; j < BArray.length; ++j) {
                    if (overlaps(AArray[i], BArray[j], false)) {
                        return true;
                    }
                }
            }
            return false;
        }

        A = cleanup(A); B = cleanup(B);

        // For future use offsetting object B, which is convenient for speculative
        // collision detection but not supported in the current implementation.
        let offsetX = 0, offsetY = 0;
        
        if (A.shape === 'disk') {
            // Swap the objects so that the rect is first, if
            // there is one
            const swap = A; A = B; B = swap;
            offsetX = -offsetX; offsetY = -offsetY;
        }
        
        // The position of object 2
        temp2.x = B.pos.x - offsetX;
        temp2.y = B.pos.y - offsetY;
        
        // If there is any rect, it is now entity A
        if (A.shape === 'disk') {
            
            // Disk-Disk. Multiply the right-hand side by 4 because
            // we're computing diameter^2 instead of radius^2
            return distanceSquared2D(A.pos, temp2) * 4 < _square(A.size.x * Math.abs(A.scale.x) + B.size.x * Math.abs(B.scale.x));
            
        } else if (B.shape === 'disk') {
            // Box A vs. Disk B 
            
            // Algorithm derivation:
            // http://stackoverflow.com/questions/401847/circle-rectangle-collision-detection-intersection
            
            // Compute the position of the center of disk B in the
            // object space of box A.  Exploit symmetry in object
            // space by moving to the first quadrant. Then, make P
            // twice as big so that we can compare to diameters
            // instead of radii below.
            const P = _toFrame(A, temp2, temp);
            P.x = 2 * Math.abs(P.x); P.y = 2 * Math.abs(P.y);
            
            if ((P.x > A.size.x * Math.abs(A.scale.x) + B.size.x * Math.abs(B.scale.x)) || (P.y > A.size.y * Math.abs(A.scale.y) + B.size.y * Math.abs(B.scale.y))) {
                // Trivially outside by box-box overlap test
                return false;
            } else if ((P.x <= A.size.x * Math.abs(A.scale.x)) || (P.y <= A.size.y * Math.abs(A.scale.y))) {
                // Trivially inside because the center of disk B is
                // inside the perimeter of box A. Note that we tested
                // twice the absolute position against twice the
                // radius.
                return true;
            } else {
                // Must be in the "corner" case. Note that these
                // squared expresissions are all implicitly multipled
                // by four because of the use of diameters instead of
                // radii.

                temp2.x = A.size.x * Math.abs(A.scale.x);
                temp2.y = A.size.y * Math.abs(A.scale.y);
                return distanceSquared2D(P, temp2) <= _square(B.size.x * B.scale.x);
            }       
            
        } else if ((A.angle === 0) && (B.angle === 0)) {
            
            // Axis-aligned Box-Box: 2D interval overlap
            return ((Math.abs(A.pos.x - temp2.x) * 2 <= (Math.abs(A.size.x * A.scale.x) + Math.abs(B.size.x * B.scale.x))) &&
                    (Math.abs(A.pos.y - temp2.y) * 2 <= (Math.abs(A.size.y * A.scale.x) + Math.abs(B.size.y * B.scale.x))));
        
        } else {
            
            // Oriented Box-box (http://www.flipcode.com/archives/2D_OBB_Intersection.shtml)
            return obbOverlapOneWay(A, B, offsetX, offsetY) && obbOverlapOneWay(B, A, -offsetX, -offsetY);
            
        }
    };
})();


function anyButtonPress() {
    return pad[0].aa || pad[0].bb || pad[0].cc || pad[0].dd || pad[0].pp || pad[0].qq ||
        pad[1].aa || pad[1].bb || pad[1].cc || pad[1].dd || pad[1].pp || pad[1].qq ||
        pad[2].aa || pad[2].bb || pad[2].cc || pad[2].dd || pad[2].pp || pad[2].qq ||
        pad[3].aa || pad[3].bb || pad[3].cc || pad[3].dd || pad[3].pp || pad[3].qq;
}


function rndSquare() {
    return {x: rnd() * 2 - 1, y: rnd() * 2 - 1};
}


function rndCircle() {
    const t = rnd() * 2 * Math.PI;
    return {x: Math.cos(t), y: Math.sin(t)}
}


function rndDisk() {
    const P = {x:0, y:0}
    let m = 0;
    do {
        P.x = rnd() * 2 - 1;
        P.y = rnd() * 2 - 1;
        m = P.x * P.x + P.y * P.y;
    } while (m > 1);
    m = 1 / m;
    P.x *= m; P.y *= m;
    return P;
}

        
var [rnd, srand] = (function() {
    /* Based on https://github.com/AndreasMadsen/xorshift/blob/master/xorshift.js

       Copyright (c) 2014 Andreas Madsen & Emil Bay

       Permission is hereby granted, free of charge, to any person obtaining a copy of this
       software and associated documentation files (the "Software"), to deal in the Software
       without restriction, including without limitation the rights to use, copy, modify,
       merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
       permit persons to whom the Software is furnished to do so, subject to the following
       conditions:

       The above copyright notice and this permission notice shall be included in all copies or
       substantial portions of the Software.

       THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
       INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
       PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
       LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT
       OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
       OTHER DEALINGS IN THE SOFTWARE.
    */
    
    var state0U = 5662365, state0L = 20000, state1U = 30000, state1L = 4095;

    function srand(seed) {
        if (seed === undefined || seed === 0) { seed = 4.7499362e+13; }
        if (seed < 2**16) { seed += seed * 1.3529423483002e15; }
        state0U = Math.abs(seed / 2**24) >>> 0;

        // Avoid all zeros
        if (state0U === 0) { state0U = 5662365; }
        
        state0L = Math.abs(seed) >>> 0;
        state1U = Math.abs(seed / 2**16) >>> 0;
        state1L = Math.abs(seed / 2**32) >>> 0;
        //console.log(seed, state0U, state0L, state1U, state1L)
    }

    function rnd() {
        // uint64_t s1 = s[0]
        var s1U = state0U, s1L = state0L;
        // uint64_t s0 = s[1]
        var s0U = state1U, s0L = state1L;

        // result = s0 + s1
        var sumL = (s0L >>> 0) + (s1L >>> 0);
        var resU = (s0U + s1U + (sumL / 2 >>> 31)) >>> 0;
        var resL = sumL >>> 0;
        
        // s[0] = s0
        state0U = s0U;
        state0L = s0L;
        
        // - t1 = [0, 0]
        var t1U = 0, t1L = 0;
        // - t2 = [0, 0]
        var t2U = 0, t2L = 0;
        
        // s1 ^= s1 << 23;
        // :: t1 = s1 << 23
        var a1 = 23;
        var m1 = 0xFFFFFFFF << (32 - a1);
        t1U = (s1U << a1) | ((s1L & m1) >>> (32 - a1));
        t1L = s1L << a1;
        // :: s1 = s1 ^ t1
        s1U = s1U ^ t1U;
        s1L = s1L ^ t1L;
        
        // t1 = ( s1 ^ s0 ^ ( s1 >> 17 ) ^ ( s0 >> 26 ) )
        // :: t1 = s1 ^ s0
        t1U = s1U ^ s0U;
        t1L = s1L ^ s0L;
        // :: t2 = s1 >> 18
        var a2 = 18;
        var m2 = 0xFFFFFFFF >>> (32 - a2);
        t2U = s1U >>> a2;
        t2L = (s1L >>> a2) | ((s1U & m2) << (32 - a2));
        // :: t1 = t1 ^ t2
        t1U = t1U ^ t2U;
        t1L = t1L ^ t2L;
        // :: t2 = s0 >> 5
        var a3 = 5;
        var m3 = 0xFFFFFFFF >>> (32 - a3);
        t2U = s0U >>> a3;
        t2L = (s0L >>> a3) | ((s0U & m3) << (32 - a3));
        // :: t1 = t1 ^ t2
        t1U = t1U ^ t2U;
        t1L = t1L ^ t2L;
        
        // s[1] = t1
        state1U = t1U;
        state1L = t1L;
        
        return resU * 2.3283064365386963e-10 + (resL >>> 12) * 2.220446049250313e-16;
    }

    return [rnd, srand];
})();


function rndInt(n) {
    return Math.min(n, floor(rnd() * (n + 1)));
}


// Calls to mutate are emitted by mutating operator processing, for example +=.
// This is use to avoid double-evaluation of r-values.
function _mutate(obj, key, op, val) {
    return obj[key] = op(obj[key], val);
}

//////////////////////////////////////////////////////////////////////////////

function _add(a, b) {
    // Keep short to encourage inlining
    return ((typeof a === 'object') && (a !== null)) ? _objectAdd(a, b) : a + b;
}

function _addMutate(a, b) {
    return ((typeof a === 'object') && (a !== null)) ? _objectAddMutate(a, b) : a += b;
}

function _objectAdd(a, b) {
    // clone, preserving prototype
    let c = a.constructor ? a.constructor() : Object.create(null);

    // avoid hasOwnProperty for speed
    if (typeof b === 'object') for (let key in a) c[key] = a[key] + b[key];
    else                       for (let key in a) c[key] = a[key] + b;
    
    return c;
}

function _objectAddMutate(a, b) {
    if (typeof b === 'object') for (let key in a) a[key] += b[key];
    else                       for (let key in a) a[key] += b;
    return a;
}

/////////////////////////////////////////////////////////////////////////////

function _neg(a) {
    return ((typeof a === 'object') && (a !== null)) ? _objectNeg(a) : -a;
}

function _objectNeg(a) {
    let c = a.constructor ? a.constructor() : Object.create(null);
    for (let key in a) c[key] = -a[key];
    return c;
}

/////////////////////////////////////////////////////////////////////////////

function _sub(a, b) {
    return ((typeof a === 'object') && (a !== null)) ? _objectSub(a, b) : a - b;
}

function _subMutate(a, b) {
    return ((typeof a === 'object') && (a !== null)) ? _objectSubMutate(a, b) : a -= b;
}

function _objectSub(a, b) {
    let c = a.constructor ? a.constructor() : Object.create(null);
    
    if (typeof b === 'object') for (let key in a) c[key] = a[key] - b[key];
    else                       for (let key in a) c[key] = a[key] - b;
    
    return c;
}

function _objectSubMutate(a, b) {
    if (typeof b === 'object') for (let key in a) a[key] -= b[key];
    else                       for (let key in a) a[key] -= b;
    return a;
}

/////////////////////////////////////////////////////////////////////////////

function _div(a, b) {
    return ((typeof a === 'object') && (a !== null)) ? _objectDiv(a, b) : a / b;
}

function _divMutate(a, b) {
    return ((typeof a === 'object') && (a !== null)) ? _objectDivMutate(a, b) : a /= b;
}

function _objectDiv(a, b) {
    let c = a.constructor ? a.constructor() : Object.create(null);

    if (typeof b === 'object') for (let key in a) c[key] = a[key] / b[key];
    else                       for (let key in a) c[key] = a[key] / b;
    
    return c;
}

function _objectDivMutate(a, b) {
    if (typeof b === 'object') for (let key in a) a[key] /= b[key];
    else                       for (let key in a) a[key] /= b;
    return a;
}

/////////////////////////////////////////////////////////////////////////////

function _mul(a, b) {
    // Special case: allow number * object
    return ((typeof a === 'object') && (a !== null)) ?
        _objectMul(a, b) :
        ((typeof b === 'object') && (b !== null)) ?
        _objectMul(b, a) :
        a * b;
}

function _mulMutate(a, b) {
    return ((typeof a === 'object') && (a !== null)) ? _objectMulMutate(a, b) : a *= b;
}

function _objectMul(a, b) {
    let c = a.constructor ? a.constructor() : Object.create(null);

    if (typeof b === 'object') for (let key in a) c[key] = a[key] * b[key];
    else                       for (let key in a) c[key] = a[key] * b;
    
    return c;
}

function _objectMulMutate(a, b) {
    if (typeof b === 'object') for (let key in a) a[key] *= b[key];
    else                       for (let key in a) a[key] *= b;
    return a;
}

/////////////////////////////////////////////////////////////////////////////

// vector operators:

function abs(a) {
    if (typeof a === 'object') {
        let c = a.constructor ? a.constructor() : Object.create(null);
        for (let key in a) c[key] = Math.abs(a[key]);
        return c;
    } else {
        return Math.abs(a);
    }
}

function floor(a) {
    if (typeof a === 'object') {
        let c = a.constructor ? a.constructor() : Object.create(null);
        for (let key in a) c[key] = Math.floor(a[key]);
        return c;
    } else {
        return Math.floor(a);
    }
}

function ceil(a) {
    if (typeof a === 'object') {
        let c = a.constructor ? a.constructor() : Object.create(null);
        for (let key in a) c[key] = Math.ceil(a[key]);
        return c;
    } else {
        return Math.ceil(a);
    }
}

function round(a) {
    if (typeof a === 'object') {
        let c = a.constructor ? a.constructor() : Object.create(null);
        for (let key in a) c[key] = Math.round(a[key]);
        return c;
    } else {
        return Math.round(a);
    }
}

function trunc(a) {
    if (typeof a === 'object') {
        let c = a.constructor ? a.constructor() : Object.create(null);
        for (let key in a) c[key] = Math.trunc(a[key]);
        return c;
    } else {
        return Math.trunc(a);
    }
}


function isArray(a) {
    return Array.isArray(a);
}


function isFunction(a) {
    return typeof a === 'function';
}


function isNil(a) {
    return (a === undefined) || (a === null);
}

function isNumber(a) {
    return typeof a === 'number';
}


function isBoolean(a) {
    return typeof a === 'boolean';
}


function isString(a) {
    return typeof a === 'string';
}


function type(a) {
    if (isArray(a)) {
        return 'array';
    } else if (isNil(a)) {
        return 'nil';
    } else {
        return typeof a;
    }
}


function isObject(a) {
    return ! isArray(a) && (typeof a === 'object');
}


function clone(a) {
    if (Array.isArray(a)) {
        return a.slice(0);
    } else if (typeof a === 'object') {
        let c = a.constructor ? a.constructor() : Object.create(null);
        return Object.assign(c, a)
    } else {
        return a;
    }
}


function copy(s, d) {
    if (Array.isArray(s)) {
        if (! Array.isArray(d)) { throw new Error("Destination must be an array"); }
        d.length = s.length;
        for (let i = 0; i < s.length; ++i) {
            d[i] = s[i];
        }
        return d;
    } else if (typeof s === 'object') {
        if (typeof d !== 'object') { throw new Error("Destination must be an object"); }
        return Object.assign(d, s);
    } else {
        throw new Error("Not an array or object");
    }
}


function perp(v) {
    if (Array.isArray(v)) {
        return [-v[1], v[0]];
    } else {
        return xy(-v.y, v.x);
    }
}


// Cross product for 3D vectors of the form [x, y, z] or {x:, y:, z:}
// for 2D vectors, returns the z component...determinant of [a;b]
function cross(a, b) {
    if (Array.isArray(a)) {
        if (a.length === 2) {
            return a[0] * b[1] - a[1] * b[0];
        } else {
            let c = a.constructor ? a.constructor() : Object.create(null);
            c[0] = a[1] * b[2] - a[2] * b[1];
            c[1] = a[2] * b[0] - a[0] * b[2];
            c[2] = a[0] * b[1] - a[1] * b[0];
            return Object.isFrozen(a) ? Object.freeze(c) : c;
        }
    } else if (a.z === undefined) {
        // 2D
        return a.x * b.y - a.y * b.x;
    } else {
        let c = a.constructor ? a.constructor() : Object.create(null);
        c.x = a.y * b.z - a.z * b.y;
        c.y = a.z * b.x - a.x * b.z;
        c.z = a.x * b.y - a.y * b.x;
        return Object.isFrozen(a) ? Object.freeze(c) : c;
    }
}

// Inner product. Always returns a Number.
function dot(a, b) {
    if (typeof a === 'number') { return a * b; }
    let s = 0;
    for (let key in a) s += a[key] * b[key];
    return s;
}

function lowerCase(s) {
    return s.toLowerCase();
}

function upperCase(s) {
    return s.toUpperCase();
}


var _superscriptTable = {'0':'⁰', '1':'¹', '2':'²', '3':'³', '4':'⁴', '5':'⁵', '6':'⁶', '7':'⁷', '8':'⁸', '9':'⁹', '+':'', '-':'⁻'};

// Pads to be two digits with zeros
function _padZero(n) {
    n = Math.min(Math.max(0, Math.floor(n)), 99);
    if (n < 10) return '0' + n;
    else        return '' + n;
}


function formatNumber(n, fmt) {
    if (fmt !== undefined && ! isString(fmt)) { throw new Error('The format argument to formatNumber must be a string'); }
    switch (fmt) {
    case 'percent':
    case '%':
        return Math.round(n * 100) + '%';
    case 'commas':
    case ',':
        return n.toLocaleString('en');
    case 'spaces':
        return n.toLocaleString('fr');
    case 'binary':
        return '0b' + n.toString(2);
    case 'degrees':
    case '°':
    case 'deg':
        return Math.round(n * 180 / Math.PI) + '°';
    case 'hex':
        return '0x' + n.toString(16);
    case 'scientific':
        {
            let x = Math.floor(Math.log10(Math.abs(n)));
            if (Math.abs(x) === Infinity) { x = 0; }
            // round to 3 decimal places in scientific notation
            let s = '' + (Math.round(n * Math.pow(10, 3 - x)) * 1e-3);
            // If rounding failed due to precision, truncate the
            // string itself
            s = s.substring(0, Math.min((n < 0) ? 6 : 5), s.length);
            s += '×10';
            const e = '' + x;
            for (let i = 0; i < e.length; ++i) {
                s += _superscriptTable[e.charAt(i)];
            }
            return s;
        }

    case 'clock12':
        {
            n = Math.round(n / 60);
            const m = n % 60;
            let h = Math.floor(n / 60);
            const suffix = ((h % 24) < 12) ? 'am' : 'pm';
            h = h % 12;
            if (h === 0) { h = 12; }
            return h + ':' + _padZero(m) + suffix;
        }
    case 'clock24':
        {
            const m = Math.floor(n / 60) % 60;
            const h = Math.floor(n / 3600) % 24;
            return h + ':' + _padZero(m);
        }
    case 'stopwatch':
        {
            const m = Math.floor(n / 60);
            const s = _padZero(n % 60);
            const f = _padZero((n - Math.floor(n)) * 100);
            return m + ':' + s + '.' + f;
        }
    case 'oldstopwatch':
        {
            const m = Math.floor(n / 60);
            const s = _padZero(n % 60);
            const f = _padZero((n - Math.floor(n)) * 100);
            return m + '"' + s + "'" + f;
        }

    case '':
    case undefined:
        return '' + n;
        
    default:
        {
            const match = fmt.match(/^( *)(0*)(\.0+)?$/);
            if (match) {
                const spaceNum = match[1].length;
                const intNum = match[2].length;
                const fracNum = match[3] ? Math.max(match[3].length - 1, 0) : 0;

                let s = Math.abs(n).toFixed(fracNum);

                let i = (fracNum === 0) ? s.length : s.indexOf('.');
                while (i < intNum) { s = '0' + s; ++i; }
                while (i < intNum + spaceNum) { s = ' ' + s; ++i; }
                if (n < 0) { s = '-' + s; }
                return s;
            } else {
                return '' + n;
            }
        }
    }
}


function shuffle(array) {
    if (! Array.isArray(array)) {
        throw new Error('The argument to shuffle() must be an array');
    }
    
    // While there remain elements to shuffle...
    for (let i = array.length - 1; i > 0; --i) {
        // Pick a remaining element...
        let j = rndInt(i - 1);
        
        // ...and swap it with the current element.
        const temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
}


function join(array, separator) {
    if (array.length === 0) {
        return '';
    } else {
        let s = typeof array[0] === 'string' ? array[0] : unparse(array[0]);
        for (let i = 1; i < array.length; ++i) {
            s += separator + (typeof array[0] === 'string' ? array[i] : unparse(array[i]));
        }
        return s;
    }
}


function shuffled(a) {
    if (Array.isArray(a)) {
        const c = clone(a);
        shuffle(c);
        return c;
    } else {
        // String case
        const c = split(a);
        shuffle(c);
        return join(c);
    }
}


function reversed(a) {
    if (Array.isArray(a)) {
        const c = clone(a);
        reverse(c);
        return c;
    } else {
        // String case
        const c = split(a);
        reverse(c);
        return join(c);
    }
}


function parse(source) {
    return _parse(source, 0).result;
}


function unparse(x) {
    return _unparse(x, new Map());
}


function _unparse(x, alreadySeen) {
    if (Array.isArray(x)) {
        if (x._name !== undefined) {
            // Internal object
            return x._name;
        } else if (alreadySeen.has(x)) {
            return '[…]';
        }
        alreadySeen.set(x, true);
        if (x.length === 0) { return "[]"; }
 
        let s = '[';
        for (let i = 0; i < x.length; ++i) {
            s += _unparse(x[i], alreadySeen) + ', ';
        }
        return s.substring(0, s.length - 2) + ']';
    }

    
    switch (typeof x) {
    case 'object':
        if (x === null) {
            return '∅';
        } else if (x._name !== undefined) {
            // Internal object
            return x._name;
        } else if (alreadySeen.has(x)) {
            return '{…}';
        } else {
            alreadySeen.set(x, true);
            
            let s = '{';
            const keys = Object.keys(x);
            for (let i = 0; i < keys.length; ++i) {
                const k = keys[i];
                // Hide underscore members
                if (k[0] !== '_') {
                    // Quote illegal identifiers used as keys
                    const legalIdentifier = /^[Δ]?(?:[A-Za-z][A-Za-z_0-9]*|[αβγδζηθιλμρσϕφχψτωΩ][_0-9]*)$/.test(k);
                    const key = legalIdentifier ? k : ('"' + k + '"');
                    s += key + ':' + _unparse(x[k], alreadySeen) + ', ';
                }
            }

            // Remove the final ', '
            return s.substring(0, s.length - 2) + '}';
        }

    case 'boolean':
        return x ? 'true' : 'false';
        
    case 'number':
        if (x === Infinity) {
            return '∞';
        } else if (x === -Infinity) {
            return '-∞';
        } else if (x === Math.PI) {
            return 'π';
        } else if (x === -Math.PI) {
            return '-π';
        } else if (x === NaN) {
            return 'nan';
        } else {
            return '' + x;
        }

    case 'undefined':
        return '∅';
        
    case 'string':
        return '"' + x + '"';

    case 'function':
        if (x.name) {
            return 'function ' + x.name;
        } else {
            return 'function';
        }

    default:
        return 'builtin';
    }
}


function magnitude(a) {
    if (typeof a === 'number') {
        return Math.hypot.apply(null, arguments);
    } else {
        return Math.sqrt(dot(a, a));
    }
}


function direction(a) {
    const m = magnitude(a);
    return (m > 0) ? _mul(a, 1.0 / m) : clone(a);
}

// Used by min and max (and mid). Assumes 'this' is bound to the corresponding Math function.
function _minOrMax(a, b) {
    const ta = typeof a, tb = typeof b;
    let allNumbers = (ta === 'number') && (tb === 'number');
    const fcn = this;

    if (allNumbers || (arguments.length > 2)) {
        // common case on only numbers
        return fcn.apply(Math, arguments);
    } else {
        if (ta === 'Number') {
            // Swap, b is the vector
            let tmp = b; b = a; a = b;
            tmp = tb; tb = ta; ta = tmp;
        }

        let c = a.constructor ? a.constructor() : Object.create(null);
        if (tb === 'Number') for (let key in a) c[key] = fcn(a[key], b);
        else                 for (let key in a) c[key] = fcn(a[key], b[key]);
        return Object.isFrozen(a) ? Object.freeze(c) : c;
    }
}

// Handles any number of arguments for Numbers, two
// arguments for vectors
function max(a, b) {
    return _minOrMax.apply(Math.max, arguments);
}
    
function min(a, b) {
    return _minOrMax.apply(Math.min, arguments);
}

function mid(a, b, c) {
    return _minOrMax.apply(Math.mid, arguments);
}

function maxComponent(a) {
    if (typeof a === 'number') { return a; }
    let s = -Infinity;
    for (let key in a) s = Math.max(s, a[key]);
    return s;
}

function minComponent(a) {
    if (typeof a === 'number') { return a; }
    let s = Infinity;
    for (let key in a) s = Math.min(s, a[key]);
    return s;
}

function lerp(a, b, t) {
    const ta = typeof a, tb = typeof b;
    if (typeof t !== 'number') { throw new Error("The third argument to lerp must be a number"); }
    if ((ta === 'number') && (tb === 'number')) {
        return _lerp(a, b, t);
    } else {
        return _add(_mul(a, 1 - t), _mul(b, t));
    }
}


function smoothstep(start, end, t) {
    t = Math.max(0, Math.min(1, (t - start) / (end - start)));
    return t * t * (3 - 2 * t);
}


function smootherstep(start, end, t) {
    t = Math.max(0, Math.min(1, (t - start) / (end - start)));
    return t * t * t * (t * (t * 6 - 15) + 10);
}


function pow(a, b) {
    const ta = typeof a, tb = typeof b;
    if (ta === 'object') {
        let c = a.constructor ? a.constructor() : Object.create(null);
        if (tb === 'number') {
            for (let key in a) c[key] = Math.pow(a[key], b);
        } else {
            for (let key in a) c[key] = Math.pow(a[key], b[key]);
        }
        return Object.isFrozen(a) ? Object.freeze(c) : c;
    } else if ((ta === 'number') && (tb === 'object')) {
        let c = b.constructor ? b.constructor() : Object.create(null);
        for (let key in b) c[key] = Math.pow(a, b[key]);
        return Object.isFrozen(a) ? Object.freeze(c) : c;
    } else {
        return Math.ceil(a, b);
    }
}

////////////////////////////////////////////////////////////////////////////////////////
//
// Path-finding
//
//

function findMapPath(map, start, goal, edgeCost, costLayer) {
    if (isArray(edgeCost)) {
        // Create an edgeTable
        const edgeTable = new Map();
        for (let i = 0; i < edgeCost.length; i += 2) {
            edgeTable.set(edgeCost[i], edgeCost[i + 1]);
        }
        
        edgeCost = function (A, B, m) {
            if (B === undefined) { return infinity; }
            const c = edgeTable.get(B);
            return (c === undefined) ? 1 : c;
        };
    }

    function estimatePathCost(A, B, m) {
        let dx = Math.abs(A.x - B.x);
        let dy = Math.abs(A.y - B.y);
        if (map.wrapX) { dx = Math.min(dx, map.size.x - 1 - dx); }
        if (map.wrapY) { dy = Math.min(dy, map.size.y - 1 - dy); }
        return dx + dy;
    }

    function getNeighbors(node, m) {
        const neighbors = [];
        if (node.x > 0) {
            neighbors.push({x:node.x - 1, y:node.y});
        } else if (map.wrapX) {
            neighbors.push({x:map.size.x - 1, y:node.y});
        }

        if (node.x < map.size.x - 1) {
            neighbors.push({x:node.x + 1, y:node.y});
        } else if (map.wrapX) {
            neighbors.push({x:0, y:node.y});
        }

        if (node.y > 0) {
            neighbors.push({x:node.x, y:node.y - 1});
        } else if (map.wrapY) {
            neighbors.push({x:node.x, y:map.size.y - 1});
        }

        if (node.y < map.size.y + 1 - 1) {
            neighbors.push({x:node.x, y:node.y + 1});
        } else if (map.wrapY) {
            neighbors.push({x:node.x, y:0});
        }
        
        return neighbors;
    }

    return findPath(floor(start), floor(goal), estimatePathCost, edgeCost, getNeighbors, function (N) { return N.x + N.y * map.size.x * 2; }, map);
}


/** Used by findPath */
function _Step(last, startCost, goalCost) {
    this.last          = last;
    this.previous      = null;
    this.costFromStart = startCost;
    this.costToGoal    = goalCost;
    this.inQueue       = true;
}

/** Used by findPath */
_Step.prototype.cost = function() {
    return this.costFromStart + this.costToGoal;
}

// A PriorityQueue is a queue that can arranges elements by cost
// instead of arrival order

function _PriorityQueue() {
    this.elementArray = [];
    this.costArray    = [];
}


/** Number of elements in the queue */
_PriorityQueue.prototype.length = function() {
    return this.elementArray.length;
}


/** Assumes that element is not already in the queue */
_PriorityQueue.prototype.insert = function(element, cost) {
    this.elementArray.push(element);
    this.costArray.push(cost);
}


/** Erases the queue */
_PriorityQueue.prototype.clear = function() {
    this.elementArray = [];
    this.costArray    = [];
}


/** Updates the cost of element in the queue */
_PriorityQueue.prototype.update = function(element, newCost) {
    const i = this.elementArray.indexOf(element);

    if (i === -1) {
        throw new Error("" + element + " is not in the PriorityQueue");
    }

    this.costArray[i] = newCost;
}


/** Removes the minimum cost element and returns it */
_PriorityQueue.prototype.removeMin = function() {
    if (this.elementArray.length === 0) {
        throw new Error("PriorityQueue is empty");
    }
    
    let j = 0;
    for (let i = 1, m = this.costArray[j]; i < this.elementArray.length; ++i) {
        if (this.costArray[i] < m) {
            m = this.costArray[i];
            j = i;
        }
    }

    const v = this.elementArray[j];
    this.costArray.splice(j, 1);
    this.elementArray.splice(j, 1);
    return v;
}


function split(str, c) {
    if (c === '') {
        return Array.from(str);
    } else {
        return str.split(c);
    }
}


function loadLocal(key) {
    let table = _window.localStorage.getItem(_gameURL);
    if (! table) { return undefined; }
    
    table = JSON.parse(table);
    let value = table[key];
    if (value) {
        return parse(value);
    } else {
        return undefined;
    }
}


function saveLocal(key, value) {
    let table = _window.localStorage.getItem(_gameURL);
    if (table) {
        table = JSON.parse(table);
    } else {
        table = {};
    }

    if (value === undefined) {
        delete table[key];
    } else {
        const v = unparse(value);
        if (v.length > 2048) {
            throw new Error('Cannot storeLocal() a value that is greater than 2048 characters after unparse()');
        }
        table[key] = v;
        if (Object.keys(table).length > 128) {
            throw new Error('Cannot storeLocal() more than 128 separate keys.');
        }
    }

    _window.localStorage.setItem(_gameURL, JSON.stringify(table));
}


/**
   Finds a good path from start to goal using the A* algorithm, and
   returns it as a list of nodes to visit.  Returns null if there is
   no path.

   map: Map

   start: Node

   goal: Node

   costEstimator: function(Map, Node, Node) that guesses what the cost
   is to go between the nodes.

   edgeCost: function(Map, Node, Node) that returns the exact cost to
   move between nodes that are known to be neighbors.

   getNeighbors: function(Map, Node) that returns an array of all
   neighbors.  

   getNodeID: function(Map, Node) that returns a unique integer or
   string for the node.  IDs must be unique and deterministic--
   getNodeID(a) === getNodeID(b) must be true if and only if a and b describe
   the same location.

   This function is designed to work with any kind of Map and Node--they 
   aren't specific classes and need not have any particular methods.

   It takes functions costEstimator, edgeCost, and getNeighbors (i.e.,
   instead of requiring methods on Map/Node) so that the map
   implementation is unconstrained, and so that the same map and nodes
   can be used with different cost estimates.  For example, a bird, a
   fish, and a cat have different movement modes and thus would have
   different costs for moving across different types of terrain in the
   same map.
*/
function findPath(start, goal, costEstimator, edgeCost, getNeighbors, nodeToID, map) {
    // Paths encoded by their last Step paired with expected shortest
    // distance
    const queue = new _PriorityQueue();
    
    // Maps each Node to the Step on the best known path to that Node.
    const bestPathTo = new Map();

    let shortest = new _Step(start, 0, costEstimator(start, goal, map));
    bestPathTo.set(nodeToID(start, map), shortest);
    queue.insert(shortest, shortest.cost());

    const goalID = nodeToID(goal, map);

    while (queue.length() > 0) {
        shortest = queue.removeMin();
        shortest.inQueue = false;

        // Last node on the shortest path
        const P = shortest.last;
        
        if (nodeToID(P, map) === goalID) {
            // We're done.  Generate the path to the goal by retracing steps
            const path = [goal];

            // Construct the path backwards
            while (shortest.previous !== null) {
                shortest = bestPathTo.get(nodeToID(shortest.previous, map));
                path.push(shortest.last);
            }
            return path.reverse();
        }

        // Consider all neighbors of P (that are still in the queue
        // for consideration)
        let neighbors = getNeighbors(P, map);
        for (let i = 0; i < neighbors.length; ++i) {
            const N = neighbors[i];
            const id = nodeToID(N, map);
            const cost = edgeCost(P, N, map);
            
            if (cost < Infinity) {
                const newCostFromStart = shortest.costFromStart + cost;
            
                // Find the current-best known way to N (or create it, if there isn't one)
                let oldBestToN = bestPathTo.get(id);
                if (oldBestToN === undefined) {
                    // Create an expensive dummy path that will immediately be overwritten
                    oldBestToN = new _Step(N, Infinity, costEstimator(N, goal, map));
                    bestPathTo.set(id, oldBestToN);
                    queue.insert(oldBestToN, oldBestToN.cost());
                }
                
                // Have we discovered a new best way to N?
                if (oldBestToN.inQueue && (oldBestToN.costFromStart > newCostFromStart)) {
                    // Update the step at this node
                    oldBestToN.costFromStart = newCostFromStart;
                    oldBestToN.previous = P;
                    queue.update(oldBestToN, oldBestToN.cost());
                }
            }
            
        } // for each neighbor
        
    } // while queue not empty

    // There was no path from start to goal
    return undefined;
}



var _GeneratorFunction = Object.getPrototypeOf(function*(){}).constructor;

/** Creates a new coroutine from code in this environment.  Invoke next() repeatedly on the
    returned object to execute it. */
function _makeCoroutine(code) {
    return (new _GeneratorFunction(code))();
}


////////////////////////////////////////////////////////////////////////////////////////
//                 Software rendering implementation of the Host API                  //
////////////////////////////////////////////////////////////////////////////////////////

/** Used by show() */
function _zSort(a, b) { return a.z - b.z; }

function getMode() {
    return _gameMode;
}

function getPreviousMode() {
    return _prevMode;
}


function pushMode(mode, note) {
    _verifyLegalMode(mode);

    // Push the stacks
    _previousModeGraphicsCommandListStack.push(_previousModeGraphicsCommandList);
    _modeFramesStack.push(modeFrames);
    _modeStack.push(_gameMode);
    _prevModeStack.push(_prevMode);

    modeFrames = 0;
    _prevMode = _gameMode;
    _gameMode = mode;
    
    _previousModeGraphicsCommandList = _previousGraphicsCommandList;

    // Reset the graphics
    _graphicsCommandList = [];
    _previousGraphicsCommandList = [];

    _systemPrint('Pushing into mode ' + mode.name + (note ? ' because "' + note + '"' : ''));

    // Run the enter callback on the new mode
    _gameMode._enter();

    throw {nextMode: mode};

}


function quitGame(note) {
    _systemPrint('Quitting the game' + (note ? ' because "' + note + '"' : ''));
    throw {quitGame:1};
}


function launchGame(url, note) {
    _systemPrint('Launching ' + url + (note ? ' because "' + note + '"' : ''));
    throw {launchGame:url};
}


function resetGame(note) {
    _systemPrint('Resetting the game' + (note ? ' because "' + note + '"' : ''));
    throw {resetGame:1};
}


function popMode(note) {
    if (_modeStack.length === 0) { throw new Error('Cannot popMode() from a mode entered by setMode()'); }

    // Run the leave callback on the current mode
    var old = _gameMode;
    _prevMode = _prevModeStack.pop();

    // Pop the stacks
    _previousModeGraphicsCommandList = _previousModeGraphicsCommandListStack.pop();
    _gameMode = _modeStack.pop();
    modeFrames = _modeFramesStack.pop();

    old._leave();

    // Reset the graphics
    _graphicsCommandList = [];
    _previousGraphicsCommandList = [];
    
    _systemPrint('Popping back to mode ' + _gameMode.name + (note ? ' because "' + note + '"' : ''));

    throw {nextMode: _gameMode};
}


function setMode(mode, note) {
    _verifyLegalMode(mode);
    
    // Erase the stacks
    _previousModeGraphicsCommandListStack = [];
    _modeFramesStack = [];
    _modeStack = [];
    _prevModeStack = [];

    // Set up the new mode
    _prevMode = _gameMode;
    _gameMode = mode;
    
    // Run the leave callback on the current mode
    if (_prevMode) { _prevMode._leave(); }
    
    modeFrames = 0;

    // Save the previous graphics list for drawPreviousMode()
    _previousModeGraphicsCommandList = _previousGraphicsCommandList;

    // Reset the graphics
    _graphicsCommandList = [];
    _previousGraphicsCommandList = [];
    
    _systemPrint('Entering mode ' + mode.name + (note ? ' because "' + note + '"' : ''));
    
    // Run the enter callback on the new mode
    _gameMode._enter();

    throw {nextMode: mode};
}


function _verifyLegalMode(mode) {
    try {
        if (mode._frame.constructor.constructor.name !== 'GeneratorFunction') {
            throw 1;
        }
    } catch (e) {
        throw new Error('Not a valid mode: ' + unparse(mode));
    }
}


function now() {
    return performance.now() * 0.001;
}


function localTime() {
    const d = new Date();
    
    return {
        year:        d.getFullYear(),
        month:       d.getMonth(),
        day:         d.getDate(),
        hour:        d.getHours(),
        minute:      d.getMinutes(),
        second:      d.getSeconds(),
        millisecond: d.getMilliseconds(),
        weekday:     d.getDay(),
        daySecond:   (d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds() + d.getMilliseconds() * 0.001,
        timezone:    d.getTimezoneOffset()
    };
}


function _show() {

    // Use modeFrames to ensure that frame 0 is always rendered for a mode
    if (modeFrames % _graphicsPeriod === 0) {
        const startTime = performance.now();
        
        // clear the screen
        if (_background.spritesheet) {
            // Image background
            _screen.set(_background.spritesheet._uint32Data);
        } else {
            // Color background (force alpha = 1)
            let c = (_colorToUint32(_background) >>> 0) | 0xff000000;
            _screen.fill(c, 0, _screen.length);
        }
        
        // Sort
        _graphicsCommandList.sort(_zSort);
        
        // Eval draw list
        for (let i = 0; i < _graphicsCommandList.length; ++i) {
            const cmd = _graphicsCommandList[i];
            _executeTable[cmd.opcode](cmd);
        }
    
        _submitFrame();
        _graphicsTime = performance.now() - startTime;
    }
    
    // Save for replays
    _previousGraphicsCommandList = _graphicsCommandList;
    
    // Clear draw list
    _graphicsCommandList = [];

    ++gameFrames;
    ++modeFrames;
}


/** Updates the z value with an epsilon and stores the current setClipping region */
function _addGraphicsCommand(cmd) {
    cmd.clipX1 = _clipX1;
    cmd.clipY1 = _clipY1;
    cmd.clipX2 = _clipX2;
    cmd.clipY2 = _clipY2;

    // Offset subsequent commands to get a unique z value for each,
    // and stable sort ordering
    cmd.z     += _graphicsCommandList.length * Math.sign(_scaleZ) * 0.0009765625;
    
    _graphicsCommandList.push(cmd);
}



/** Color is 32-bit RGBA. This implementation assumes a little-endian
    processor (which includes all current Intel, AMD, ARM, Raspberry
    Pi processors by default). DataView can be used to make an
    endian-independent version if required. */
function _pset(x, y, color, clipX1, clipY1, clipX2, clipY2) {
    // nano pixels have integer centers, so we must round instead of just truncating.
    // Otherwise -0.7, which is offscreen, would become 0 and be visible.
    //
    // "i >>> 0" converts from signed to unsigned int, which forces negative values to be large
    // and lets us early-out sooner in the tests.
    const i = Math.round(x) >>> 0;
    const j = Math.round(y) >>> 0;

    if ((i <= clipX2) && (j <= clipY2) && (i >= clipX1) && (y >= clipY1)) {
        const offset = i + j * _SCREEN_WIDTH;

        // Must be unsigned shift to avoid sign extension
        const a255 = color >>> 24;

        if (a255 === 0xff) {
            // No blending
            _screen[offset] = color;
        } else if (a255 > 0) {
            // Blend

            // No need to force to unsigned int because the alpha channel of the output is always 0xff
            
            const a = a255 * (1 / 255);
            let back = _screen[offset];
            let result = 0xFF000000;
            result |= ((back & 0x00FF0000) * (1 - a) + (color & 0x00FF0000) * a + 0.5) & 0x00FF0000;
            result |= ((back & 0x0000FF00) * (1 - a) + (color & 0x0000FF00) * a + 0.5) & 0x0000FF00;
            result |= ((back & 0x000000FF) * (1 - a) + (color & 0x000000FF) * a + 0.5) & 0x000000FF;
            _screen[offset] = result;
        }
    }
}

/** Assumes x2 >= x1 and that color is RGBA. Does not assume that x1 and x2 or y are
    on screen. */
function _hline(x1, y, x2, color, clipX1, clipY1, clipX2, clipY2) {
    x1 = Math.round(x1) | 0;
    x2 = Math.round(x2) | 0;
    y  = Math.round(y) | 0;

    if ((x2 >= clipX1) && (x1 <= clipX2) && (y >= clipY1) && (y <= clipY2)) {
        // Some part is on screen

        // Don't draw past the edge of the screen
        x1 = Math.max(x1, clipX1);
        x2 = Math.min(x2, clipX2);
        
        let a255 = color >>> 24;
        if (a255 === 0xff) {
            // Overwrite
            _screen.fill(color, x1 + (y * _SCREEN_WIDTH), x2 + (y * _SCREEN_WIDTH) + 1);
        } else if (a255 > 0) {
            // Blend (see comments in _pset)
            const a = a255 * (1 / 255);
            const r = (color & 0x00FF0000) * a + 0.5;
            const g = (color & 0x0000FF00) * a + 0.5;
            const b = (color & 0x000000FF) * a + 0.5;

            for (let x = x1, offset = x1 + y * _SCREEN_WIDTH; x <= x2; ++x, ++offset) {
                let back = _screen[offset];
                let result = 0xFF000000;
                result |= ((back & 0x00FF0000) * (1 - a) + r) & 0x00FF0000;
                result |= ((back & 0x0000FF00) * (1 - a) + g) & 0x0000FF00;
                result |= ((back & 0x000000FF) * (1 - a) + b) & 0x000000FF;
                _screen[offset] = result;
            }
        }
    }
}

/** Assumes y2 >= y1 and that color is RGBA. Does not assume that y1 and y2 or x are
    on screen */
function _vline(x, y1, y2, color, clipX1, clipY1, clipX2, clipY2) {
    x  = Math.round(x) | 0;
    y1 = Math.round(y1) | 0;
    y2 = Math.round(y2) | 0;
    
    if ((y2 >= clipY1) && (y1 <= clipY2) && (x >= clipX1) && (x <= clipX2)) {
        y1 = Math.max(clipY1, y1);
        y2 = Math.min(clipY2, y2);

        let a255 = color >>> 24;
        if (a255 === 0xff) {
            for (let y = y1, offset = y1 * _SCREEN_WIDTH + x; y <= y2; ++y, offset += _SCREEN_WIDTH) {
                _screen[offset] = color;
            }
        } else if (a255 > 0) {
            // Blend (see comments in _pset)
            const a = a255 * (1 / 255);
            const r = (color & 0x00FF0000) * a + 0.5;
            const g = (color & 0x0000FF00) * a + 0.5;
            const b = (color & 0x000000FF) * a + 0.5;
            for (let y = y1, offset = y1 * _SCREEN_WIDTH + x; y <= y2; ++y, offset += _SCREEN_WIDTH) {
                let back = _screen[offset];
                let result = 0xFF000000;
                result |= ((back & 0x00FF0000) * (1 - a) + r) & 0x00FF0000;
                result |= ((back & 0x0000FF00) * (1 - a) + g) & 0x0000FF00;
                result |= ((back & 0x000000FF) * (1 - a) + b) & 0x000000FF;
                _screen[offset] = result;
            }
        }
    }
}


function _executeCIR(cmd) {
    const outline = cmd.outline, color = cmd.color,
          x = cmd.x, y = cmd.y, radius = cmd.radius;
    
    const clipX1 = cmd.clipX1, clipY1 = cmd.clipY1,
          clipX2 = cmd.clipX2, clipY2 = cmd.clipY2;
    
    if (color & 0xff000000) {
        // offset
        let ox = radius - 1, oy = 0;
        
        // step
        let dx = 1, dy = 1;
        let err = dx - radius * 2;

        // Midpoint circle algorithm. Iterate over 1/8 of the circle,
        // reflect to all sides
        while (ox >= oy) {
            _hline(x - ox, y + oy, x + ox, color, clipX1, clipY1, clipX2, clipY2);
            _hline(x - ox, y - oy, x + ox, color, clipX1, clipY1, clipX2, clipY2);
            
            _hline(x - oy, y + ox, x + oy, color, clipX1, clipY1, clipX2, clipY2);
            _hline(x - oy, y - ox, x + oy, color, clipX1, clipY1, clipX2, clipY2);

            // -4 gives better shape for small circles
            if (err <= -4) {
                ++oy;
                err += dy;
                dy += 2;
            }

            // intentionally no "else" to allow diagonal jumps
            
            if (err > -4) {
                --ox;
                dx += 2;
                err += dx - radius * 2;
            }
        } // while
    } // if color

    
    if ((outline & 0xff000000) && (outline !== color)) {
        // offset
        let ox = radius - 1, oy = 0;
        
        // step
        let dx = 1, dy = 1;
        let err = dx - radius * 2;

        while (ox >= oy) {
            _pset(x - ox, y + oy, outline, clipX1, clipY1, clipX2, clipY2);
            _pset(x + ox, y + oy, outline, clipX1, clipY1, clipX2, clipY2);
            
            _pset(x - oy, y + ox, outline, clipX1, clipY1, clipX2, clipY2);
            _pset(x + oy, y + ox, outline, clipX1, clipY1, clipX2, clipY2);
            
            _pset(x - ox, y - oy, outline, clipX1, clipY1, clipX2, clipY2);
            _pset(x + ox, y - oy, outline, clipX1, clipY1, clipX2, clipY2);
            
            _pset(x - oy, y - ox, outline, clipX1, clipY1, clipX2, clipY2);
            _pset(x + oy, y - ox, outline, clipX1, clipY1, clipX2, clipY2);

            if (err <= -4) {
                ++oy;
                err += dy;
                dy += 2;
            }

            if (err > -4) {
                --ox;
                dx += 2;
                err -= radius * 2 - dx;
            }
        } // while
    } // if outline
}


function _executeREC(cmd) {
    const outline = cmd.outline, fill = cmd.fill,
          clipX1 = cmd.clipX1, clipY1 = cmd.clipY1,
          clipX2 = cmd.clipX2, clipY2 = cmd.clipY2;
    
    let x1 = cmd.x1, x2 = cmd.x2, y1 = cmd.y1, y2 = cmd.y2;

    if ((outline !== fill) && (outline > 0xFFFFFF)) {
        _hline(x1, y1, x2, outline, clipX1, clipY1, clipX2, clipY2);
        _hline(x1, y2, x2, outline, clipX1, clipY1, clipX2, clipY2);
        _vline(x1, y1 + 1, y2 - 1, outline, clipX1, clipY1, clipX2, clipY2);
        _vline(x2, y1 + 1, y2 - 1, outline, clipX1, clipY1, clipX2, clipY2);
        x1 += 1; y1 += 1; x2 -= 1; y2 -= 1;
    }

    if (fill & 0xff000000) {
        
        // Snap to integer and setClip to screen. We don't need to
        // round because we know that the rect is visible.
        x1 = Math.max((x1 + 0.5) | 0, clipX1);
        x2 = Math.min((x2 + 0.5) | 0, clipX2);
        y1 = Math.max((y1 + 0.5) | 0, clipY1);
        y2 = Math.min((y2 + 0.5) | 0, clipY2);

        // Blend spans
        for (let y = y1, i = y1 * _SCREEN_WIDTH; y <= y2; ++y, i += _SCREEN_WIDTH) {
            _hline(x1, y, x2, fill, clipX1, clipY1, clipX2, clipY2);
        }
    }
}


function _executeLIN(cmd) {
    _line(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.color, cmd.clipX1, cmd.clipY1, cmd.clipX2, cmd.clipY2);
}


function _line(x1, y1, x2, y2, color, clipX1, clipY1, clipX2, clipY2) {
    if (y1 === y2) {
        // Horizontal perf optimization/avoid divide by zero
        _hline(Math.min(x1, x2), y1, Math.max(x1, x2), color, clipX1, clipY1, clipX2, clipY2);
    } else if (x1 === x2) {
        // Vertical perf optimization
        _vline(x1, Math.min(y1, y2), Math.max(y1, y2), color, clipX1, clipY1, clipX2, clipY2);
    } else {
        // General case via DDA

        // Slope:
        const dx = x2 - x1, dy = y2 - y1;
        const moreHorizontal = abs(dx) > abs(dy);

        if ((moreHorizontal && (x2 < x1)) ||
            (! moreHorizontal && (y2 < y1))) {
            // Swap endpoints to go in increasing direction on the dominant axis.
            // Slope is unchanged because both deltas become negated.
            let temp;
            temp = y1; y1 = y2; y2 = temp;
            temp = x1; x1 = x2; x2 = temp;
        }

        if (moreHorizontal) {
            // Crop horizontally:
            const m = dy / dx;
            const step = Math.max(clipX1, x1) - x1;
            x1 += step; y1 += m * step;
            x2 = Math.min(x2, clipX2);
            for (let x = x1, y = y1; x <= x2; ++x, y += m) {
                _pset(x, y, color, clipX1, clipY1, clipX2, clipY2);
            } // for x
        } else { // Vertical
            // Compute the inverted slope
            const m = dx / dy;
            // Crop vertically:
            const step = Math.max(clipY1, y1) - y1;
            x1 += step * m; y1 += step;
            y2 = Math.min(y2, clipY2);
            for (let y = y1, x = x1; y <= y2; ++y, x += m) {
                _pset(x, y, color, clipX1, clipY1, clipX2, clipY2);
            } // for y
            
        } // if more horizontal
    } // if diagonal
}


function _executePIX(cmd) {
    // Series of points that have already been clipped
    // and converted to integers.
    
    const data = cmd.data;
    const N = data.length;
    for (let p = 0; p < N; p += 3) {
        
        const offset = data[p] + data[p + 1] * _SCREEN_WIDTH;
        const color = data[p + 2];

        // Must be unsigned shift to avoid sign extension
        const a255 = color >>> 24;

        if (a255 === 0xff) {
            // No blending
            _screen[offset] = color;
        } else if (a255 > 0) {
            // Blend

            // No need to force to unsigned int because the alpha channel of the output is always 0xff
            
            const a = a255 * (1 / 255);
            let back = _screen[offset];
            let result = 0xFF000000;
            result |= ((back & 0x00FF0000) * (1 - a) + (color & 0x00FF0000) * a + 0.5) & 0x00FF0000;
            result |= ((back & 0x0000FF00) * (1 - a) + (color & 0x0000FF00) * a + 0.5) & 0x0000FF00;
            result |= ((back & 0x000000FF) * (1 - a) + (color & 0x000000FF) * a + 0.5) & 0x000000FF;
            _screen[offset] = result;
        }
    }

    //_pset(data[0], data[1], data[2], cmd.clipX1, cmd.clipY1, cmd.clipX2, cmd.clipY2);
}


function _executeMAP(cmd) {
    // One blt command that we'll mutate
    const bltCmd = {clipX1: cmd.clipX1, clipX2: cmd.clipX2, clipY1: cmd.clipY1, clipY2: cmd.clipY2,
                    x:0, y:0, z: cmd.z, angle: 0, scaleX: 1, scaleY: 1, opacity: 1, overrideColor: undefined}

    // Submit each sprite
    for (let i = 0; i < cmd.layerData.length; ++i) {
        const data = cmd.layerData[i];
        bltCmd.sprite = data.sprite;
        bltCmd.x = data.x;
        bltCmd.y = data.y;
        bltCmd.scaleX = bltCmd.sprite.scale.x;
        bltCmd.scaleY = bltCmd.sprite.scale.y;
        _executeBLT(bltCmd);
    }
}


function _executeBLT(cmd) {
    // Note that these are always integers, which we consider
    // pixel centers.
    const clipX1 = cmd.clipX1, clipY1 = cmd.clipY1,
          clipX2 = cmd.clipX2, clipY2 = cmd.clipY2;

    let opacity = cmd.opacity;

    const spr = cmd.sprite;

    const overrideColor = cmd.overrideColor;
    
    // Compute the net transformation matrix

    // Source bounds, inclusive
    const srcX1 = spr._x, srcX2 = spr._x + spr.size.x - 1,
          srcY1 = spr._y, srcY2 = spr._y + spr.size.y - 1;
    
    // The net forward transformation is: (note that SX, SY = source center, not scale!)
    // c = cos, s = sin, f = scale
    //
    // [srcx]   [1 0 SX][1/fx 0   0][ c -s 0][1 0 -DX][dstx]
    // [srcy] = [0 1 SY][0   1/fy 0][ s  c 0][0 1 -DY][dsty]
    // [ 1  ]   [0 0  1][0    0   1][ 0  0 1][0 0   1][ 1  ]
    //
    // [srcx]   [1 0 SX][c/fx -s/fx 0][1 0 -DX][dstx]
    // [srcy] = [0 1 SY][s/fy  c/fy 0][0 1 -DY][dsty]
    // [ 1  ]   [0 0  1][  0    0   1][0 0   1][ 1  ]
    //
    // A = c/fx, B = -s/fx, C = s/fy, D = c/fy
    //
    // [srcx]   [1 0 SX][A B 0][1 0 -DX][dstx]
    // [srcy] = [0 1 SY][C D 0][0 1 -DY][dsty]
    // [ 1  ]   [0 0  1][0 0 1][0 0   1][ 1  ]
    //
    // [srcx]    [A B (SX - A*DX - B*DY)][dstx]
    // [srcy] =  [C D (SY - C*DX - D*DY)][dsty]
    //                                   [ 1  ]
    //
    // The inverse transformation for computing destination bounds is:
    //  
    // [dstx]   [1 0 DX][ c s 0][fx  0 0][1 0 -SX][srcx]
    // [dsty] = [0 1 DY][-s c 0][ 0 fy 0][0 1 -SY][srcy]
    // [ 1  ]   [0 0  1][ 0 0 1][ 0  0 1][0 0   1][ 1  ]
    //
    // E = c*fx, F = -s*fx, G = s*fy, H = c*fy
    //
    // [dstx]   [E F DX][srcx - SX]
    // [dsty] = [G H DY][srcy - SY]
    //                  [   1     ]
    
    // Source and destination centers
    const DX = cmd.x, DY = cmd.y,
          SX = srcX1 + spr.size.x * 0.5, SY = srcY1 + spr.size.y * 0.5;

    const cos = Math.cos(cmd.angle), sin = Math.sin(cmd.angle);
    const fx = cmd.scaleX, fy = cmd.scaleY;

    const A = cos/fx, B = -sin/fx, C = sin/fy, D = cos/fy;
    const E = cos*fx, F =  sin*fx, G = -sin*fy, H = cos*fy;
    const I = DX - SX*E - SY*G, J = DY - SX*F - SY*H;

    ////////////////////////////////////////////////////////////////////////////////
    // Compute the (inclusive) destination bounds by projecting all
    // four corners from texture space to screen space
    
    let dstX1 = Infinity, dstX2 = -Infinity,
        dstY1 = Infinity, dstY2 = -Infinity;

    for (let i = 0; i <= 1; ++i) {
        for (let j = 0; j <= 1; ++j) {
            // Coordinates of the bounding box extremes
            const srcX = srcX1 + i * spr.size.x,
                  srcY = srcY1 + j * spr.size.y;

            // Transform from texture space to pixel space
            let tmp = E * (srcX - SX) + G * (srcY - SY) + DX;
            dstX1 = Math.min(tmp, dstX1); dstX2 = Math.max(tmp, dstX2);
            
            tmp     = F * (srcX - SX) + H * (srcY - SY) + DY;
            dstY1 = Math.min(tmp, dstY1); dstY2 = Math.max(tmp, dstY2);
        }
    }

    // Round the bounding box using the drawRect rules for inclusive integer
    // bounds with open top and left edges at pixel center samples.
    dstX1 = Math.round(dstX1); dstY1 = Math.round(dstY1);
    dstX2 = Math.floor(dstX2 - 0.5); dstY2 = Math.floor(dstY2 - 0.5);

    // Restrict to the clipping region
    dstX1 = Math.max(dstX1, clipX1); dstY1 = Math.max(dstY1, clipY1);
    dstX2 = Math.min(dstX2, clipX2); dstY2 = Math.min(dstY2, clipY2);

    // Iterate over *output* pixel centers in this region. Because the
    // transformed texel centers won't usually land exactly on pixel
    // centers, we have to be conservative with the bounds here.
    //
    // Don't snap the bounds to integers...we want to hit points that
    // correspond to texel centers in the case where there is no
    // rotation or scale (we'll end up rounding the actual destination
    // pixels later and stepping in integer increments anyway).
    
    let srcData = spr.spritesheet._uint32Data;
    const srcDataWidth = srcData.width;

    if ((! spr._hasAlpha) && (Math.abs(opacity - 1) < 1e-10) &&
        (Math.abs(Math.abs(A) - 1) < 1e-10) && (Math.abs(B) < 1e-10) &&
        (Math.abs(C) < 1e-10) && (Math.abs(Math.abs(D) - 1) < 1e-10) &&
        (! overrideColor)) {
        // Simple case; x and y-axis uniform scale, no rotation, and no alpha
        // test. Use a memcpy.  The x and y-axes may be inverted, and there
        // can be xy translation applied. This branch is primarily
        // here to accelerate map rendering.
        
        const width = (dstX2 - dstX1 + 1) | 0;
        if (width >= 1) {
            const srcY = ((dstY1 + 0.4999 - DY) * D + SY) | 0;
            let srcOffset = (((dstX1 + 0.4999 - DX) + SX) | 0) + srcY * srcDataWidth;
            let dstOffset = (dstX1 + dstY1 * _SCREEN_WIDTH) | 0;
            const srcStep = (srcDataWidth * D) | 0;

            if (A < 0) {
                // Use the flipped version
                srcOffset += srcDataWidth - 2 * SX;
                srcData = spr.spritesheet._uint32DataFlippedX;
            }
            

            for (let dstY = dstY1; dstY <= dstY2; ++dstY, dstOffset += _SCREEN_WIDTH, srcOffset += srcStep) {
                // This TypedArray.set call saves about 3.5 ms/frame
                // compared to an explicit horizontal loop for map
                // rendering on Firefox. Chrome and Safari are fast
                // even for the general case, so this isn't as
                // necessary on those browsers...but it doesn't hurt.
                
                //console.assert(dstOffset + width <= _screen.length, `dstX1=${dstX1}, dstX2 = ${dstX2}, _screen.length = ${_screen.length}, width = ${width}, dstOffset = ${dstOffset}, dstOffset % _SCREEN_WIDTH = ${dstOffset % _SCREEN_WIDTH}, dstY = ${dstY}, dstY2 = ${dstY2}`);
                // console.assert(srcOffset + width <= srcData.length);
                _screen.set(srcData.slice(srcOffset, srcOffset + width), dstOffset);
            } // dstY
        }
    } else {

        // General case. It doesn't help performance to break out the
        // case of no rotation with alpha test and optimize that
        // separately.

        if (overrideColor) {
            opacity *= overrideColor.a;
        }
        
        const override = overrideColor ? _colorToUint32(overrideColor) : 0;
        
        for (let dstY = dstY1; dstY <= dstY2; ++dstY) {
            // Offset everything by 0.5 to transform the pixel
            // center. Needs to be *slightly* less in order to round
            // the correct way.
            const xterms = (dstY + 0.4999 - DY) * B + SX;
            const yterms = (dstY + 0.4999 - DY) * D + SY;
            
            let dstOffset = dstX1 + dstY * _SCREEN_WIDTH;
            
            for (let dstX = dstX1; dstX <= dstX2; ++dstX, ++dstOffset) {
                const srcX = ((dstX + 0.4999 - DX) * A + xterms) | 0;
                const srcY = ((dstX + 0.4999 - DX) * C + yterms) | 0;

                // Show bounds
                //_screen[dstOffset] = 0xffffffff;// continue;
                
                if ((srcX >= srcX1) && (srcX <= srcX2) && (srcY >= srcY1) && (srcY <= srcY2)) {
                    // Inside the source sprite

                    // May be overriden below.
                    let color = srcData[srcX + srcY * srcDataWidth];
                    
                    if (opacity < 1) {
                        // Make more transparent
                        
                        // 4 high bits
                        const alpha4 = ((color >>> 28) * opacity + 0.5) | 0;
                        color = ((alpha4 << 28) | (alpha4 << 24) | (color & 0xFFFFFF)) >>> 0;
                    }
                    
                    // the following is an inlining of: _pset(dstX, dstY, color, clipX1, clipY1, clipX2, clipY2);
                    
                    // Must be unsigned shift to avoid sign extension
                    const a255 = color >>> 24;
                    
                    if (a255 >= 0xf0) {
                        // No blending
                        _screen[dstOffset] = overrideColor ? override : color;
                    } else if (a255 > 0x0f) {
                        // Blend

                        if (overrideColor) { color = override; }
                        
                        // No need to force to unsigned int because the alpha channel of the output is always 0xff
                        const a = a255 * (1 / 255);
                        const back = _screen[dstOffset];
                        let result = 0xFF000000;

                        result |= ((back & 0x00FF0000) * (1 - a) + (color & 0x00FF0000) * a + 0.5) & 0x00FF0000;
                        result |= ((back & 0x0000FF00) * (1 - a) + (color & 0x0000FF00) * a + 0.5) & 0x0000FF00;
                        result |= ((back & 0x000000FF) * (1 - a) + (color & 0x000000FF) * a + 0.5) & 0x000000FF;
                        
                        _screen[dstOffset] = result;
                    }
                
                } // clamp to source bounds
            } // i
        } // j
    } // if simple case
}


function _executeTXT(cmd) {
    const height = cmd.height, width = cmd.width, color = cmd.color,
          str = cmd.str, outline = cmd.outline, shadow = cmd.shadow;
    const clipX1 = cmd.clipX1, clipY1 = cmd.clipY1,
          clipX2 = cmd.clipX2, clipY2 = cmd.clipY2;
    const font = cmd.font;
    const data = font._data.data;
    const fontWidth = font._data.width;

    let x = cmd.x, y = cmd.y;
    
    for (let c = 0; c < str.length; ++c) {
        // Remap the character to those in the font sheet
        const chr = _fontMap[str[c]] || ' ';
        const bounds = font._bounds[chr];

        x += bounds.pre;
        if (chr !== ' ') {
            const tileY = Math.floor(bounds.y1 / font._charHeight) * font._charHeight;
            const charWidth  = bounds.x2 - bounds.x1 + 1;
            const charHeight = bounds.y2 - bounds.y1 + 1;

            // Shift the destination down by the offset of this character relative to the tile
            for (let j = 0, dstY = y + bounds.y1 - tileY + bounds.yOffset; j < charHeight; ++j, ++dstY) {
                // On screen in Y?
                if (((dstY >>> 0) <= _clipY2) && (dstY >= clipY1)) {
                    for (let i = 0, dstX = x, dstIndex = x + (dstY * _SCREEN_WIDTH), srcIndex = bounds.x1 + (bounds.y1 + j) * fontWidth;
                         i < charWidth;
                         ++i, ++dstX, ++dstIndex, ++srcIndex) {
                        
                        const bits = data[srcIndex];

                        // Most pixels in fonts are empty, so explicitly test if ANY bit
                        // is set before looking deeper
                        if (bits) {
                            let v = 0;
                            if (bits & 0x1) {
                                v = color;
                            } else if (shadow & 0xff000000) {
                                if (bits & 0x8) {
                                    // Shadow + outline
                                    v = outline;
                                } else if (bits & 0x4) {
                                    // Shadow 
                                    v = shadow;
                                }
                            } else if (bits & 0x2) {
                                // Outline
                                v = outline;
                            }

                            // TODO: inline _pset code for performance, use dstIndex
                            if (v) { _pset(dstX, dstY, v, clipX1, clipY1, clipX2, clipY2); }
                        }
                    } // for i
                } // on screen y
            } // for j
            
        } // character in font

        x += (bounds.x2 - bounds.x1 + 1) + font._spacing.x - font._borderSize * 2 + bounds.post;
        
    } // for each character
}


function _executeTRI(cmd) {
    const clipX1 = cmd.clipX1, clipY1 = cmd.clipY1,
          clipX2 = cmd.clipX2, clipY2 = cmd.clipY2;
    const color = cmd.color, outline = cmd.outline, Ax = cmd.Ax, Ay = cmd.Ay,
          Bx = cmd.Bx, By = cmd.By, Cx = cmd.Cx, Cy = cmd.Cy;
    
    // Fill
    if (color & 0xff000000) {
        const shift = ((outline & 0xff000000) && (outline !== color)) ? 0.5 : 0;
        // For each non-horizontal edge, store:
        //
        //    [startX, startY, dx/dy slope, vertical height].
        //
        // These are the values needed for the edge-intersection test.  Add edges so that the
        // start Y coordinate is less than the end one.
        const edgeArray = [];

        // vertical bounds on the triangle
        let y0 = clipY2 + 1, y1 = clipY1 - 1;
        
        function addEdge(Sx, Sy, Ex, Ey) {
            if (Sy < Ey) {
                // Update bounding box
                if (Sy < y0) { y0 = Sy; }
                if (Ey > y1) { y1 = Ey; }
                edgeArray.push([Sx, Sy, (Ex - Sx) / (Ey - Sy), Ey - Sy]);
            } else if (Sy > Ey) {
                addEdge(Ex, Ey, Sx, Sy);
            }
        }
        
        addEdge(Ax, Ay, Bx, By);
        addEdge(Bx, By, Cx, Cy);
        addEdge(Cx, Cy, Ax, Ay);

        // Intentionally left as a float to avoid int->float
        // conversion within the inner loop
        y0 = Math.max(clipY1, Math.floor(y0));
        y1 = Math.min(clipY2, Math.floor(y1));
        for (let y = y0; y <= y1; ++y) {
            
            // For this scanline, intersect the edge lines of the triangle.
            // As a convex polygon, we can simply intersect ALL edges and then
            // take the min and max intersections.
            let x0 = Infinity, x1 = -Infinity;
            for (let i = edgeArray.length - 1; i >= 0; --i) {
                const edge = edgeArray[i];
                const edgeX = edge[0], edgeY = edge[1], slope = edge[2], edgeHeight = edge[3];

                // Find the intersection
                const dy = y - edgeY;
                if ((dy >= 0) && (dy <= edgeHeight)) {
                    const x = edgeX + dy * slope;
                    x0 = Math.min(x0, x);
                    x1 = Math.max(x, x1);
                }
            }

            // If there was a nonzero line length, draw it
            if (x0 + shift <= x1 - shift) {
                _hline(x0 + shift, y, x1 - shift, color, clipX1, clipY1, clipX2, clipY2);
            }
        }
    }

    if ((outline & 0xff000000) && (outline !== color)) {
        _line(Ax, Ay, Bx, By, outline, clipX1, clipY1, clipX2, clipY2);
        _line(Bx, By, Cx, Cy, outline, clipX1, clipY1, clipX2, clipY2);
        _line(Cx, Cy, Ax, Ay, outline, clipX1, clipY1, clipX2, clipY2);
    }
}


var _executeTable = Object.freeze({
    REC : _executeREC,
    CIR : _executeCIR,
    BLT : _executeBLT,
    PIX : _executePIX,
    TXT : _executeTXT,
    LIN : _executeLIN,
    TRI : _executeTRI,
    MAP : _executeMAP
});
