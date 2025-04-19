/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */

// quadplay runtime and hardware layer.
//
// Variables named with a leading $ are illegal in
// quadplay/pyxlscript, and will therefore such variables and
// functions in this file will not be visible to the program.

'use strict';

// If undefined, the virtual GPU runs on the same thread as the CPU.
var $GPU;
if ($THREADED_GPU) {
    $GPU = new Worker('quadplay-runtime-gpu.js');
    $GPU.onmessage = function (event) {
        if (event.data.type !== 'submitFrame') {
            $console.log('Unknown message received from GPU: ', event);
            return;
        }

        console.assert(event.data.updateImageData);
        console.assert(event.data.updateImageData32);
        
        // Paste the updateImageData32 back
        $updateImageData = event.data.updateImageData;
        $updateImageData32 = event.data.updateImageData32;

        {
            const startTime = performance.now();

            // Unfortunately, JavaScript APIs force us to make a copy here via
            // the ImageData constructor. There does not appear to be a way
            // to make it share a view of the buffer.
            $updateImageData = new ImageData(new Uint8ClampedArray($updateImageData32.buffer),
                                             $updateImageData.width,
                                             $updateImageData.height);
            
            $submitFrame($updateImageData, $updateImageData32, event.data.gpuTime);
            
            // This will typically measure a cost about 1/20 ms on a
            // desktop...that is, 0ms 19 times and then 1ms the 20th
            // time on average.
            $logicToGraphicsTimeShift += performance.now() - startTime;
        }
    };
}

var $Object = Object;
var $console = console;
var $Math = Math;
var $performance = performance;

// If non-nil and matches the current mode, then the Copy Host
// Code/Copy Host URL buttons are displayed. See also start_hosting()
var $showCopyButtonsMode = undefined;

// Invoked by the paste host code button
var $paste_host_code_callback = undefined;

var $feature_768x448 = false;
var $feature_custom_resolution = false;

var $gameMode = undefined, $prevMode = undefined;
var $numBootAnimationFrames = 120;

// Modes from pop_mode. Does not contain $gameMode
var $modeStack = [], $prevModeStack = [];

// Overriden by setFramebufferSize() and $resize_framebuffer()
var $SCREEN_WIDTH = 384, $SCREEN_HEIGHT = 224;

var $previousModeGraphicsCommandList = [];

var $screen;

/** List of graphics commands to be sorted and then executed by $submitFrame(). */
var $previousGraphicsCommandList = [];
var $graphicsCommandList = [];
var $background = {r:0, g:0, b:0, a:1};

var joy = null; // initialized by reloadRuntime()
var gamepad_array = null; // initialized by reloadRuntime()

var $hashview = new DataView(new ArrayBuffer(8));

var $customPauseMenuOptions = [];

// This tests for all typed
// arrays, not just Uint8Array (https://stackoverflow.com/questions/15251879/how-to-check-if-a-variable-is-a-typed-array-in-javascript)
function $isTypedArray(a) {
    return ((a instanceof Object.getPrototypeOf(Uint8Array)) ||
            (a.buffer instanceof ArrayBuffer) ||
            (typeof a.buffer === 'object' && a.buffer.byteLength !== undefined && a.buffer.resizable !== undefined));
}
     

function $set_texture(spritesheetArray, fontArray) {
    if (spritesheetArray.length) {
        // Test for data transfer correctness
        console.assert(spritesheetArray[0].$uint16Data.width !== undefined);
    }
   
    // In web worker mode, send a message
    if ($GPU) {
        // console.log('sending set_texture');
        $GPU.postMessage({
            type: 'set_texture',
            spritesheetArray: spritesheetArray,
            fontArray: fontArray});
    } else {
        // Call directly
        $gpu_set_texture(spritesheetArray, fontArray);
    }
}


function $resize_framebuffer(w, h) {
    // console.log('resize_framebuffer()');
    $SCREEN_WIDTH = w;
    $SCREEN_HEIGHT = h;

    // In web worker mode, send a message
    if ($GPU) {
        $GPU.postMessage({type: 'resize_framebuffer', SCREEN_WIDTH: w, SCREEN_HEIGHT: h})
    } else {
        // Call directly
        $gpu_resize_framebuffer(w, h);
    }
}

// Does not contain $previousModeGraphicsCommandList
var $previousModeGraphicsCommandListStack = [];
var $frameHooks = [];

var game_frames = 0;
var mode_frames = 0;

// Graphics execute once out of this many frames.  Must be an integer
// between 1 (60 Hz), and 6 (10 Hz). This is managed by
// quadplay-profiler.js. Note that game logic always executes at 60
// Hz.
var $graphicsPeriod = 1;

// $skipGraphics = (mode_frames % $graphicsPeriod !== 0)
// Set by quadplay-profiler.js and whenever mode_frames is forced
// to zero, so that new modes will always draw their first frame.
var $skipGraphics = false;

// Time spent in graphics this frame, for use by quadplay-profiler.js.
// Set by $show().
var $graphicsTime = 0;

// Number of missed frames when using a virtual GPU due to backlog,
// for use by quadplay-profiler.js. Set by $show().
var $missedFrames = 0;

// Time to move from the logic accounting to the graphics accounting
var $logicToGraphicsTimeShift = 0;

// Only used on Safari
var $currentLineNumber = 0;

var $mode_framesStack = [];

var $postFX;

// Deprecated
var is_NaN = Number.isNaN;
var is_nan = Number.isNaN;

// Maps container objects to the count of how many iterators
// they are currently used within, so that the runtime can
// detect when they are illegally being mutated.
var $iteratorCount = new WeakMap();

function $checkContainer(container) {
    if (! Array.isArray(container) && (typeof container !== 'string') && (typeof container !== 'object')) {
        $error('The container used with a for...in loop must be an object, string, or array. (was ' + unparse(container) + ')');
    }
}

function reset_post_effects() {
    $postFX = {
        background: {r:0, g:0, b:0, a:0},
        color: {r:0, g:0, b:0, a:0},
        color_blend: "source-over",
        bloom: 0,
        scale: {x: 1, y: 1},
        angle: 0,
        pos: {x:0, y:0},
        motion_blur: 0,
        afterglow: {r: 0, g: 0, b: 0}
    };

    // Not bound during the initial load because it is called
    // immediately to set the initial value.
    if (gamepad_array && (gamepad_array[0].status === 'host')) {
        $notifyGuestsOfPostEffects();
    }
}

reset_post_effects();

function get_post_effects() {
    return clone($postFX);
}

function set_post_effects(args) {
    if (args.color !== undefined) {
        $postFX.color.r = (args.color.r !== undefined) ? args.color.r : 0;
        $postFX.color.g = (args.color.g !== undefined) ? args.color.g : 0;
        $postFX.color.b = (args.color.b !== undefined) ? args.color.b : 0;
        $postFX.color.a = (args.color.a !== undefined) ? args.color.a : 1;
    }

    switch (args.color_blend) {
    case undefined: break;
    case 'source-over':
    case 'hue':
    case 'multiply':
    case 'difference':
        $postFX.color_blend = args.color_blend;
        break;
    default: $error('Illegal color_blend for post effects: "' + args.color_blend + '"');
    }

    if (args.scale !== undefined) {
        if (typeof args.scale === 'number') {
            $postFX.scale.x = $postFX.scale.y = args.scale;
        } else {
            $postFX.scale.x = (args.scale.x !== undefined) ? args.scale.x : 1;
            $postFX.scale.y = (args.scale.y !== undefined) ? args.scale.y : 1;
        }
    }

    if (args.angle !== undefined) {
        $postFX.angle = args.angle;
    }

    if (args.pos !== undefined) {
        $postFX.pos.x = (args.pos.x !== undefined) ? args.pos.x : SCREEN_WIDTH / 2;
        $postFX.pos.y = (args.pos.y !== undefined) ? args.pos.y : SCREEN_HEIGHT / 2;
    }
    
    if (args.motion_blur !== undefined) {
        $postFX.motion_blur = clamp(args.motion_blur, 0, 1);
    }

    if (args.afterglow !== undefined) {
        $postFX.afterglow.r = (args.afterglow.r !== undefined) ? args.afterglow.r : 0;
        $postFX.afterglow.g = (args.afterglow.g !== undefined) ? args.afterglow.g : 0;
        $postFX.afterglow.b = (args.afterglow.b !== undefined) ? args.afterglow.b : 0;
    }

    if (args.bloom !== undefined) {
        $postFX.bloom = clamp(args.bloom, 0, 1);
    }

    if (gamepad_array && (gamepad_array[0].status === 'host')) {
        $notifyGuestsOfPostEffects();
    }
}


function delay(callback, frames, data) {
    return add_frame_hook(undefined, callback, frames || 0, undefined, data);
}


function sequence(...seq) {
    // Is there any work?
    if (seq.length === 0) { return; }

    if (Array.isArray(seq[0])) {
        $error("sequence() does not accept an array argument. Use sequence(...array) instead.");
    }
    
    let totalLifetime = 0;
    const queue = [];
    
    for (let i = 0; i < seq.length; ++i) {
        const entry = seq[i];
        if (typeof entry === 'function' || entry === undefined) {
            ++totalLifetime;
            queue.push({callback: entry, frames: 1, begin_callback: undefined, end_callback: undefined, data: undefined})
        } else {
            if (typeof entry !== 'number' && typeof entry !== 'object') {
                $error("Illegal sequence entry. Must be a function, nil, number, or object");
            }
            
            let frames = (typeof entry === 'number') ? entry : entry.frames;
            frames = (frames <= 0.5) ? 0 : $Math.max(1, $Math.round(frames || 1));
            if (frames > 0) {
                
                queue.push({
                    callback: entry.callback,
                    begin_callback: entry.begin_callback,
                    end_callback: entry.end_callback,
                    frames: frames,
                    data: entry.data});
                
                totalLifetime += frames;
            }
        }
    }
    
    let currentFrame = 0;
    function update(framesleft, lifetime) {
        if (queue.length === 0) {
            remove_frame_hook(hook);
            return;
        }
        
        const step = queue[0];
        
        if (step.callback || step.begin_callback || step.end_callback) {
            if (currentFrame === 0 && step.begin_callback) {
                const result = step.begin_callback(step.data);
                if (result === sequence.BREAK) {
                    remove_frame_hook(hook);
                    return;
                }
            }
            
            const result = step.callback ? step.callback(step.frames - currentFrame - 1, step.frames, step.data) : undefined;
            
            if (result === sequence.BREAK) {
                remove_frame_hook(hook);
                return;
            } else if (result === sequence.NEXT) {
                // Immediately advance
                if (step.end_callback && (step.end_callback(step.data) === sequence.BREAK)) {
                    remove_frame_hook(hook);
                    return;
                }
                pop_front(queue);
                currentFrame = 0;
                return;
            }
        }
        ++currentFrame;

        if (currentFrame >= step.frames) {
            if (step.end_callback && (step.end_callback(step.data) === sequence.BREAK)) {
                remove_frame_hook(hook);
                return;
            }
            pop_front(queue);
            currentFrame = 0;
        }
    }

    // The hook is referenced above and needs to be in this scope
    const hook = add_frame_hook(update, undefined, totalLifetime);

    return hook;
}

sequence.NEXT = ["NEXT"];
sequence.BREAK = ["BREAK"];



function add_frame_hook(callback, endCallback, frames, mode, data) {
    if (mode === undefined) { mode = get_mode(); }
    if (mode === "all") { mode = undefined; }
    if (is_nan(frames)) { $error("nan frames on add_frame_hook()"); }
    const hook = {$callback:callback, $endCallback:endCallback, $mode:mode, $frames:frames, $maxFrames:frames, $data:data};
    $frameHooks.push(hook);
    return hook;
}


function remove_frame_hook(hook) {
    remove_values($frameHooks, hook);
}


function remove_frame_hooks_by_mode(mode) {
    for (let i = 0; i < $frameHooks.length; ++i) {
        if ($frameHooks[i].$mode === mode) {
            $frameHooks[i] = $frameHooks[$frameHooks.length - 1];
            --i;
            --$frameHooks.length;
        }
    }
}


function $processFrameHooks() {
    // Clone the hooks, so that it is safe to iterate over this
    // array even if other hooks are adding and removing more hooks
    const array = $frameHooks.slice();
    for (let i = 0; i < array.length; ++i) {
        const hook = array[i];
        if ((hook.$mode === undefined) || (hook.$mode === $gameMode)) {
            --hook.$frames;
            
            const r = hook.$callback ? hook.$callback(hook.$frames, hook.$maxFrames - 1, hook.$data) : 0;

            // Remove the hook *before* the callback executes so that if a
            // set_mode happens within the callback it does not
            // re-trigger
            if (r || (hook.$frames <= 0)) {
                fast_remove_value($frameHooks, hook);
            }
            
            if (! r && (hook.$frames <= 0)) {
                // End hook
                if (hook.$endCallback) { hook.$endCallback(hook.$data); }
            }
        }
    }        
}


function draw_previous_mode() {
    if ($skipGraphics) { return; }
    Array.prototype.push.apply($graphicsCommandList, $previousModeGraphicsCommandList);
}

////////////////////////////////////////////////////////////////////
// Array

function last_value(s) {
    return s[s.length - 1];
}

function last_key(s) {
    if (! Array.isArray(s) || typeof s === 'string') {
        $error('Argument to last_key() must be a string or array');
    }
    return size(s) - 1;
}


/* The value is cloned for each entry. If size is an xy(), 
   makes a 2D array, which is an array of arrays with a size 
   property. */
function make_array(size, value, value_clone) {
    if (size.z !== undefined) {
        if (size.y === undefined || size.x === undefined) {
            $error('3D array size must also have x and y properties');
        }
        
        const array3D = make_array(size.x);
        for (let x = 0; x < size.x; ++x) {
            const array2D = array3D[i] = make_array({x: size.y, y: size.z}, value, value_clone);
            array2D.size = xz(size);
        }
        array2D.size = clone(size);
        
        return array2D;
    } else if (size.y !== undefined) {
        if (size.x === undefined) {
            $error('2D array size must also have an x property');
        }
        // 2D
        const array2D = make_array(size.x);
        for (let x = 0; x < size.x; ++x) {
            array2D[x] = make_array(size.y, value, value_clone);
        }
        array2D.size = clone(size);
        
        return array2D;
    } else {
        // 1D
        const array = []
        for (let i = 0; i < size; ++i) {
            array[i] = value_clone ? value_clone(value) : value;
        }
        return array;
    }
}


function contains(a, x, comparator) {
    return find(a, x, undefined, comparator) !== undefined;
}


function find(a, x, start, comparator) {
    // Type of what we are looking for
    const t = typeof x;
    
    // Run the regular find if using equivalent() on trivial values or
    // if there is no comparator. Otherwise, do the general case
    if ((comparator !== undefined) && (! (comparator === equivalent && ((t === 'number' && ! is_nan(x)) || t === 'undefined' || t === 'function' || t === 'string' || t === 'boolean' || (typeof a === 'string'))))){
        if (Array.isArray(a) || typeof a === 'string') {
            const L = a.length;
            start = start || 0;
            for (let i = start; i < L; ++i) {
                if (comparator(a[i], x)) { return i; }
            }
        } else { // Object
            if (start === undefined) {
                for (let k in a) {
                    if (comparator(a[k], x)) { return k; }
                }
            } else {
                // Do not compare until the start key is observed
                for (let k in a) {
                    if ((start !== undefined) && comparator(a[k], start)) {
                        start = undefined;
                    }
                    
                    if ((start === undefined) && comparator(a[k], x)) {
                        return k;
                    }
                }
            } // if start
        }
    } else if (Array.isArray(a)) {
        const L = a.length;
        for (let i = start || 0; i < L; ++i) {
            if (a[i] === x) { return i; }
        }
    } else if (typeof a === 'string') {
        const i = a.indexOf(x, start || 0);
        if (i !== -1) { return i; }
    } else {
        if (start === undefined) {
            for (let k in a) {
                if (a[k] === x) { return k; }
            }
        } else {
            // Start key specified
            // Do not compare until the start key is observed
            for (let k in a) {
                if ((start !== undefined) && (a[k] === start)) {
                    start = undefined;
                }
                if ((start == undefined) && (a[k] === start)) {
                    return k;
                }
            }
        }
    }
    
    return undefined;
}


function insert(array, i, ...args) {
    if (! Array.isArray(array)) { $error('insert(array, index, value) requires an array argument'); }
    if (typeof i !== 'number') { $error('insert(array, index, value) requires a numeric index'); }
    if ($iteratorCount.get(array)) {
        $error('Cannot insert() while using a container in a for loop. Use push(), or clone() the container in the for loop declaration.');
    }
    array.splice(i, 0, ...args)
    return array[i];
}


function push(array, ...args) {
    if (! Array.isArray(array)) { $error('push() requires an array argument'); }

    // Push is safe during iteration because it only adds to the end
    // of the array and both the FOR loop and iterate() check the
    // length of the array every iteration and work forwards.
    
    array.push(...args);
    return array[array.length - 1];
}


function push_front(array, ...args) {
    if (! Array.isArray(array)) { $error('push_front() requires an array argument'); }
    if ($iteratorCount.get(array)) {
        $error('Cannot push_front() while using a container in a for loop. Call clone() on the container in the for loop declaration.');
    }
    array.unshift(...args);
    return array[0];
}


function pop_front(array) {
    if (! Array.isArray(array)) { $error('pop_front() requires an array argument'); }
    if ($iteratorCount.get(array)) {
        $error('Cannot pop_front() while using a container in a for loop. Call clone() on the container in the for loop declaration.');
    }
    if (array.length === 0) { return undefined;  }
    return array.shift();
}


function pop(array) {
    if ($iteratorCount.get(array)) {
        $error('Cannot pop() while using a container in a for loop. Call clone() on the container in the for loop declaration.');
    }
    return array.pop();
}


function $defaultComparator(a, b) {
    return (a < b) ? -1 : (a > b) ? 1 : 0;
}


function $defaultReverseComparator(b, a) {
    return (a < b) ? -1 : (a > b) ? 1 : 0;
}


function sorted(array, k, reverse) {
    array = clone(array);
    sort(array, k, reverse);
    return array;
}


function sort(array, k, reverse) {
    let compare = k;
    
    if (compare === undefined) {
        if (typeof array[0] === 'object') {
            // Find the first property, alphabetically
            const keys = Object.keys(array[0]);
            keys.sort();
            k = keys[0];
            if (reverse) {
                compare = function (a, b) { return $defaultComparator(a[k], b[k]); };
            } else {
                compare = function (a, b) { return $defaultComparator(b[k], a[k]); };
            }
        } else if (reverse) {
            // Just use the default reverse comparator
            compare = $defaultReverseComparator;
        } else {
            // Just use the default comparator
            compare = $defaultComparator;
        }
    } else if (typeof compare !== 'function') {
        // sort by index or key k
        if (reverse) {
            compare = function (a, b) { return $defaultComparator(b[k], a[k]); };
        } else {
            compare = function (a, b) { return $defaultComparator(a[k], b[k]); };
        }
    } else if (reverse) {
        compare = function (a, b) { return k(b, a); };
    }

    array.sort(compare);
}


function resize(a, n) {
    if ($iteratorCount.get(a)) {
        $error('Cannot resize() while using a container in a for loop. Call clone() on the container in the for loop declaration.');
    }
    a.length = n;
}

/////////////////////////////////////////////////////////////////////
//
// Table and Array

function size(x) {
    if (Array.isArray(x)) {
        return x.length;
    } else if (x === null || x === undefined) {
        return 0;
    } else {
        let tx = typeof x;
        if (tx === 'string') {
            return x.length;
        } else if (tx === 'object') {
            const k = Object.keys(x);
            if (x.$name || x.$type) {
                // Hide any $ prefixes from this built-in object
                let c = 0;
                for (let i = 0; i < k.length; ++i) {
                    if (k[i] !== '$') { ++c; }
                }
                return c;
            } else {
                return k.length;
            }
        } else {
            return 0;
        }
    }
}


function random_from_distribution(distribution, rng) {
    let sum = 0;
    
    if (Array.isArray(distribution)) {
        for (let i = 0; i < distribution.length; ++i) {
            sum += $Math.abs(distribution[i]);
        }
    } else {
        // Object case
        for (let k in distribution) {
            if (k[0] !== '$') {
                sum += $Math.abs(distribution[k]);
            }
        }
    }

    if (sum === 0) { $error('random_from_distribution requires a non-empty object or array'); }

    // Choose a value
    let r = random(0, sum, rng);

    if (Array.isArray(distribution)) {
        for (let i = 0; i < distribution.length; ++i) {
            r -= $Math.abs(distribution[i]);
            if (r <= 0) { return i; }
        }
        return distribution.length - 1;
    } else {
        // Object case, check for hidden fields
        let lastKey;
        for (let k in distribution) {
            if (k[0] !== '$') {
                r -= $Math.abs(distribution[k]);
                lastKey = k;
                if (r <= 0) { return k; }
            }
        }
        return lastKey;
    }    
}


function random_value(t, rng) {
    const T = typeof t;
    if (Array.isArray(t) || (T === 'string')) {
        return t[random_integer(0, t.length - 1, rng)];
    } else if (T === 'object') {
        const k = keys(t);

        if (k.length === 0) {
            return undefined;
        } else {
            return t[k[random_integer(0, k.length - 1, rng)]];
        }
    } else {
        return undefined;
    }
}


function random_key(t, rng) {
    const T = typeof t;
    if (Array.isArray(t) || (T === 'string')) {
        return random_integer(0, t.length - 1, rng);
    } else if (T === 'object') {
        const k = keys(t);

        if (k.length === 0) {
            return undefined;
        } else {
            return k[random_integer(0, k.length - 1, rng)];
        }
    } else {
        return undefined;
    }
}


function remove_all(t) {
    if ($iteratorCount.get(t)) {
        $error('Cannot remove_all() while using a container in a for loop. Call clone() on the container in the for loop declaration.');
    }
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


function remove_values(t, value) {
    let any = false;
    
    if ($iteratorCount.get(t)) {
        $error('Cannot remove_values() while using a container in a for loop. Call clone() on the container in the for loop declaration.');
    }
    
    if (Array.isArray(t)) {
        // Place to copy the next element to
        let dst = 0;
        for (let src = 0; src < t.length; ++src) {
            if (src > dst) { t[dst] = t[src]; }
            if (t[src] !== value) { ++dst; }
        }
        if (dst !== t.length) {
            t.length = dst;
            any = true;
        }
    } else if (typeof t === 'object') {
        for (let k in t) {
            if (t[k] === value) {
                delete t[k];
                any = true;
            }
        }
    }

    return any;
}


function fast_remove_value(t, value) {
    if ($iteratorCount.get(t)) {
        $error('Cannot fast_remove_value() while using a container in a for loop. Call clone() on the container in the for loop declaration.');
    }
    if (Array.isArray(t)) {
        for (let i = 0; i < t.length; ++i) {
            if (t[i] === value) {
                t[i] = t[t.length - 1];                
                t.pop();
                return;
            }
        }
    } else if (typeof t === 'object') {
        for (let k in t) {
            if (t[k] === value) {
                delete t[k];
                return;
            }
        }
    }
}


function iterate(array, callback, ...args) {
    if (! is_string(callback) && !is_function(callback)) {
        $error('The callback to iterate() must be a function or string property name');
    }

    if (array === undefined) {
        $error('Array argument to iterate() is nil');
    }
    
    // Place to copy the next element to
    let dst = 0;
    let done = false;

    const stringCase = is_string(callback);

    let removedAny = false;
    
    $iteratorCount.set(array, ($iteratorCount.get(array) || 0) + 1);
    try {
        for (let src = 0; src < array.length; ++src) {
            const value = array[src]
            if (src > dst) { array[dst] = value; }
            
            let r = 0; // continue 
            if (done) {
                ++dst;
            } else {
                let fcn = callback;
                
                if (stringCase) {
                    fcn = value[callback];
                    if (fcn !== undefined && typeof fcn !== 'function') {
                        $error("value does not have callback in iterate()");
                    }
                }
                
                r = fcn && fcn(value, ...args);
                
                if (r === iterate.REMOVE_AND_BREAK) {
                    removedAny = true;
                    done = true;
                } else if (r === iterate.BREAK) {
                    if (removedAny) {
                        // Have to continue iteration for removal copies
                        done = true;
                        ++dst;
                    } else {
                        // Can stop immediately
                        return false;
                    }
                } else if (r === iterate.REMOVE) {
                    removedAny = true;
                } else {
                    // Move on to the next element
                    ++dst;
                }
            } // if not done
        } // for src
    } finally {
        $iteratorCount.set(array, $iteratorCount.get(array) - 1);
    }
    
    // Remove extra elements
    resize(array, dst);
    return removedAny;
}


iterate.REMOVE = "REMOVE";
iterate.BREAK  = "BREAK";
iterate.REMOVE_AND_BREAK = "REMOVE_AND_BREAK";
iterate.CONTINUE = "CONTINUE";
Object.freeze(iterate);


function iterate_pairs(array, callback, ...args) {
    let any_remove = false;
    for (let a = 0; a < array.length; ++a) {
        for (let b = a + 1; b < array.length; ++b) {
            let result = callback(array[a], array[b], ...args);

            if (result && result !== iterate.CONTINUE &&
                !(Array.isArray(result) &&
                  result[0] === iterate.CONTINUE &&
                  result[1] === iterate.CONTINUE)) {
                    
                // Expand single cases
                if (! Array.isArray(result)) { result = [result, result]; }

                // Process:
                switch (result[1]) {
                case iterate.REMOVE:
                    remove_key(array, b);
                    any_remove = true;
                    --b;
                    break;
                    
                case iterate.REMOVE_AND_BREAK:
                    remove_key(array, b);
                    any_remove = true;
                    // Fall through
                    
                case iterate.BREAK:
                    b = array.length;
                    break;
                } // switch result_b

                
                switch (result[0]) {
                case iterate.REMOVE:
                    any_remove = true;
                    remove_key(array, a);
                    --a;

                    // Stop the inner loop because A is gone, but continue
                    // iteration.
                    b = array.length;
                    break;
                    
                case iterate.REMOVE_AND_BREAK:
                    remove_key(array, a);
                    any_remove = true;

                    // Indices don't matter because we're breaking out of iteration
                    
                    // Fall through
                    
                case iterate.BREAK:
                    // Stop all iteration
                    return any_remove;
                } // switch result_a
            }
        } // b
    } // a

    return any_remove;
}



function reverse(array) {
    if (! Array.isArray(array)) { $error('reverse() takes an array as the argument'); }
    array.reverse();
}


function remove_key(t, i) {
    if ($iteratorCount.get(t)) {
        $error('Cannot remove_key() while using a container in a for loop. Call clone() on the container in the for loop declaration.');
    }

    if (arguments.length !== 2) {
        $error('remove_key() requires exactly two arguments');
    }
    
    if (Array.isArray(t)) {
        if (typeof i !== 'number') { throw 'remove_key(array, i) called with a key (' + i + ') that is not a number'; }
        t.splice(i, 1);
    } else if (typeof t === 'object') {
        delete t[i];
    } else {
        $error('remove_key() requires a container as the first argument');
    }
}


function extend(a, b) {
    if ($iteratorCount.get(a)) {
        $error('Cannot extend() while using a container in a for loop. Call clone() on the container in the for loop declaration.');
    }
    if (Array.isArray(a)) {
        if (! Array.isArray(b)) {
            $error('Both arguments to extend(a, b) must have the same type. Invoked with one array and one non-array.');
        }

        const oldLen = a.length;
        a.length += b.length;
        const newLen = a.length;
        for (let i = oldLen, j = 0; i < newLen; ++i, ++j) {
            a[i] = b[j];
        }
    } else {
        if (Array.isArray(b)) {
            $error('Both arguments to extend(a, b) must have the same type. Invoked with one object and one array.');
        }
        // Object
        for (let k in b) {
            a[k] = b[k];
        }
    }
}


function animation_frame(animation, f) {
    f = $Math.floor(f);
    const N = animation.length;

    if (animation.extrapolate === 'clamp') {
        // Handle out of bounds cases by clamping
        if (f < 0) { return animation[0]; }
        if (f >= animation.frames) { return animation[N - 1]; }
    } else {
        // Handle out of bounds cases by looping. To handle negatives, we need
        // to add and then mod again. Mod preserves fractions.
        f = ((f % animation.period) + animation.period) % animation.period;
    }

    if (animation.extrapolate === 'oscillate') {
        // Oscillation will give us twice the actual number of frames from the
        // looping, so we need to figure out which part of the period we're in.
        const reverseTime = (animation.period + animation[0].frames + animation[N - 1].frames) / 2;
        if (f >= reverseTime) {
            // Count backwards from the end
            f -= reverseTime;
            let i = N - 2;
            while ((i > 0) && (f >= animation[i].frames)) {
                f -= animation[i].frames;
                --i;
            }
               
            return animation[i];
        }
    }
    
    // Find the value by searching linearly within the array (since we do not
    // store cumulative values to binary search by).
    let i = 0;
    while ((i < N) && (f >= animation[i].frames)) {
        f -= animation[i].frames;
        ++i;
    }
    
    return animation[$Math.min(i, N - 1)];
}



function array_value(animation, frame, extrapolate) {
    if (! Array.isArray(animation) && (typeof animation !== 'string')) {
        if (animation === undefined || animation === null) {
            $error('Passed nil to array_value()');
        } else {
            $error('The first argument to array_value() must be an array or string (was ' + unparse(animation) + ')');
        }
    }
    
    frame = $Math.floor(frame);
    switch (extrapolate || animation.extrapolate || 'clamp') {
    case 'oscillate':
        frame = oscillate(frame, animation.length - 1);
        break;
    
    case 'loop':
        frame = loop(frame, animation.length);
        break;
        
    default:
        frame = $clamp(frame, 0, animation.length - 1)
    }
      
    return animation[frame];
}


function concatenate(a, b) {
    if (Array.isArray(a)) {
        if (! Array.isArray(b)) {
            $error('Both arguments to concatenate(a, b) must have the same type. Invoked with one array and one non-array.');
        }
        a = clone(a);
        extend(a, b);
        return a;
    } else if (is_string(a)) {
        if (! is_string(b)) {
            $error('Both arguments to concatenate(a, b) must have the same type. Invoked with one string and one non-string.');
        }
        return a + b;
    } else {
        if (Array.isArray(b)) {
            $error('Both arguments to concatenate(a, b) must have the same type. Invoked with one object and one array.');
        }
        a = clone(a);
        extend(a, b);
        return a;
    }
}

var extended = concatenate;


function fast_remove_key(t, i) {
    if ($iteratorCount.get(t)) {
        $error('Cannot fast_remove_key() while using a container in a for loop. Call clone() on the container in the for loop declaration.');
    }
    if (Array.isArray(t)) {
        if (typeof i !== 'number') { throw 'fast_remove_key(array, i) called with a key (' + i + ') that is not a number'; }
        let L = t.length;
        t[i] = t[L - 1];
        t.length = L - 1;
    } else if (typeof t === 'object') {
        delete t[key];
    }
}


function keys(t) {
    const k = $Object.keys(t);
    
    if (t.$name || t.$type) {
        // Remove hidden properties
        for (let i = k.length - 1; i >= 0; --i) {
            if (k[i][0] === '$') {
                k[i] = k[k.length - 1];
                --k.length;
            }
        }
    }

    return k;
}

function values(t) {
    return Object.values(t);
}


/////////////////////////////////////////////////////////////////////
//
// String

function starts_with(str, pattern) {
    return str.startsWith(pattern);
}

function ends_with(str, pattern) {
    return str.endsWith(pattern);
}

// Helper for replace()
function $entryKeyLengthCompare(a, b) {
    return b[0].length - a[0].length;
}

function replace(s, src, dst) {

    const ESCAPABLES = /([\/\,\!\\\^\$\{\}\[\]\(\)\.\*\+\?\|\<\>\-\&])/g;
    
    if (typeof s !== 'string') {
        $error('The first argument to replace() must be a string');
    }
    
    if (s === '' || src === '') { return s; }

    if (typeof src === 'object') {
        if (dst !== undefined) {
            $error("replace(string, object) requires exactly two arguments");
        }
        
        // Generate the replacement regexp that will find all target
        // patterns simultaneously.  We have to do this instead of
        // replacing sequentially because there might be cyclic
        // replacement patterns and we don't want to double-replace.
        //
        // In this pattern, escape any aspect of the target that would
        // be misinterpreted as a regexp character.
        let R = '';
        for (const pattern in src) {
            R += (R.length === 0 ? '' : '|') + pattern.replace(ESCAPABLES, '\\$&');
        }

        return s.replace(new RegExp(R, 'g'), function (match) {
            return src[match];
        });
        
    } else {
        // String replace
        if (dst === undefined || src === undefined) {
            $error("Use replace(string, object) or replace(string, string, string)");
        }
        if (typeof src !== 'string') { src = unparse(src); }
        if (typeof dst !== 'string') { dst = unparse(dst); }

        return s.replaceAll(src, dst);
    }
}


function slice(a, s, e) {
    if (Array.isArray(a)) {
        return a.slice(s, e);
    } else if (is_string(a)) {
        return a.substring(s, e);
    } else {
        $error('slice() requires an array or string argument.');
    }
}


function trim_spaces(s) {
    return s.trim();
}

//////////////////////////////////////////////////////////////////////
//

function make_spline(timeSrc, controlSrc, order, extrapolate) {
    // Argument checking
    if (controlSrc.length < 2) { $error('Must specify at least two control points'); }
    if (order === undefined) { order = 3; }
    if (extrapolate === undefined) { extrapolate = 'stall'; }
    if (find(['stall', 'loop', 'clamp', 'continue', 'oscillate'], extrapolate) === undefined) {
        $error('extrapolate argument to make_spline must be "stall", "loop", "clamp", or "continue"');
    }

    if (controlSrc.length < 4 && order === 3) {
        $error('order 3 splines require at least 4 control points.');
    }
    
    order = $Math.round(order);
    if (order === 2 || order < 0 || order > 3) { $error('order must be 0, 1, or 3'); }

    // Clone the arrays adn elements in them
    const time = [], control = [];
    
    for (let i = 0; i < timeSrc.length; ++i) {
        time[i] = timeSrc[i];
        if ((i > 0) && (time[i] <= time[i - 1])) {
            $error('times must increase through the array');
        }
        control[i] = clone(controlSrc[i]);
    }

    if (extrapolate === 'loop') {
        if (time.length !== controlSrc.length + 1) {
            $error('There must be one more time than value to use "loop" extrapolation');
        }
        // Duplicate the last control point, which was previously null
        control[control.length - 1] = clone(control[0]);
    } else if (timeSrc.length !== controlSrc.length) {
        $error('time and value arrays must have the same size');
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
        array index in outTimeArray and outControlArray.  

        If the array index is out of bounds, wraps (for a cyclic
        spline) or linearly extrapolates (for a non-cyclic spline),
        assuming time intervals follow the first or last sample
        recorded.
    */
    function getControl(i, outTimeArray, outControlArray, outIndex) {
        let t, c;

        if (extrapolate === 'loop') {
            c = control[$Math.floor(loop(i, N))];
            if (i < 0) {
                // Wrapped around bottom

                // Number of times we wrapped around the cyclic array
                const wraps = $Math.floor((N + 1 - i) / N);
                const j = (i + wraps * N) % N;
                t = time[j] - wraps * duration;

            } else if (i < N) {
                // Normal case: no wrap
                t = time[i];

            } else {
                // Wrapped around top

                // Number of times we wrapped around the cyclic array
                const wraps = $Math.floor(i / N);
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
        Assumes that time[0] <= s < time[N - 1].  called by compute_index. Returns {i, u} */
    function computeIndexInBounds(s) {
        $console.assert((s < time[N - 1]) && (time[0] <= s));
        const t0 = time[0];
        const tn = time[N - 1];

        if (s > time[N - 1]) {
            $console.assert(extrapolate === 'loop');
            return {i:N - 1, u:(s - time[N - 1]) / (time[N] - time[N - 1])};
        }

        // Guess a linear start index
        let i = $Math.floor((N - 1) * (s - t0) / (tn - t0));
    
        // Inclusive bounds for binary search
        let hi = N - 1;
        let lo = 0;
    
        while ((time[i] > s) || ((i < time.length - 1) && (time[i + 1] <= s))) {
            if (hi <= lo) {
                $console.log(lo, hi, i, s);
                $error('Infinite loop?');
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
    function compute_index(s) {
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
                i = $Math.floor(x);
                u = x - i;
                return {i:i, u:u};
                
            } else if (s >= tn) {
                // Non-cyclic, off the top.  Assume points are spaced following
                // the last time interval.
                const dt = tn - time[N - 2];
                const x = (N - 1) + (s - tn) / dt;
                i = $Math.floor(x);
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
    } // compute_index
    

    /* Derived from the G3D Innovation Engine (https://casual-effects.com/g3d).
       Return the position at time s.  The spline is defined outside
       of the time samples by extrapolation or cycling. */
    function evaluate(s) {
        if (extrapolate === 'clamp') {
            if (s < time[0]) { return clone(control[0]); }
            else if (s > time[N - 1]) { return clone(control[N - 1]); }
        }
        
        const indexResult = compute_index(s);
        // Index of the first control point
        const i = indexResult.i;
        // Fractional part of the time
        const u = indexResult.u;

        // Array of 4 control points and control times.  p[1] is the
        // one below this time and p[2] is above it.  The others are
        // needed to provide derivatives at the ends.
        let p = [], t = [];
        for (let j = 0; j < 4; ++j) {
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

        const dp0 = $sub(p[1], p[0]);
        const dp1 = $sub(p[2], p[1]);
        const dp2 = $sub(p[3], p[2]);

        // The factor of 1/2 from averaging two time intervals is 
        // already factored into the basis
        
        // tan1 = (dp0 / dt0 + dp1 / dt1) * ((dt0 + dt1) * 0.5);
        // The last term normalizes for unequal time intervals
        const x = (dt0 + dt1) * 0.5;
        
        const n0 = x / dt0;
        const n1 = x / dt1;
        const n2 = x / dt2;

        const dp1n1 = $mul(dp1, n1);
        
        const tan1 = $add($mul(dp0, n0), dp1n1);
        const tan2 = $add(dp1n1, $mul(dp2, n2));

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

        return $add($add(
                    $add($mul(tan1, weights[0]),
                         $mul(p[1], weights[1])),
                         $mul(p[2], weights[2])),
                         $mul(tan2, weights[3]));
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

/** Callback to show the screen buffer and yield to the browser. Set by
    reloadRuntime() */
var $submitFrame = null;

// Scissor (set_clipping) region. This is inclusive and is expressed in
// terms of pixel indices.
var $clipY1 = 0, $clipY2 = $SCREEN_HEIGHT - 1, $clipZ1 = -2047, $clipX1 = 0, $clipX2 = $SCREEN_WIDTH - 1, $clipZ2 = 2048;

// Transform
var $offsetX = 0, $offsetY = 0, $offsetZ = 0, $scaleX = 1, $scaleY = 1, $scaleZ = 1, $skewXZ = 0, $skewYZ = 0;

// Camera
var $camera = {
    // Raw fields
    x:     0,
    y:     0,
    z:     0,
    angle: 0,
    zoom:  1,

    // Used for tracking whether get_camera() should return a 2D or 3D pos.z
    has_pos_z: false
};

var $graphicsStateStack = [];


function $pushGraphicsState() {
    $graphicsStateStack.push({
        cx1:$clipX1, cy1:$clipY1, cz1:$clipZ1,
        cx2:$clipX2, cy2:$clipY2, cz2:$clipZ2, 
        ax:$offsetX, ay:$offsetY, az:$offsetZ,
        sx:$scaleX,  sy:$scaleY,  sz:$scaleZ,
        kx:$skewXZ,  ky:$skewYZ,

        camera_x: $camera.x,
        camera_y: $camera.y,
        camera_z: $camera.z,
        camera_angle: $camera.angle,
        camera_zoom: $camera.zoom
    });
}


function $popGraphicsState() {
    const s = $graphicsStateStack.pop();
    $offsetX = s.ax; $offsetY = s.ay; $offsetZ = s.az;
    $scaleX = s.sx; $scaleY = s.sy; $scaleZ = s.sz;
    $skewXZ = s.kx; $skewYZ = s.ky;

    $clipX1 = s.cx1; $clipY1 = s.cy1; $clipZ1 = s.cz1;
    $clipX2 = s.cx2; $clipY2 = s.cy2; $clipZ2 = s.cz2;

    $camera.x = s.camera_x;
    $camera.y = s.camera_y;
    $camera.z = s.camera_z;
    $camera.angle = s.camera_angle;
    $camera.zoom = s.camera_zoom;
}


function reset_camera() {
    set_camera({x:0, y:0}, 0, 1, 0);
}


function set_camera(pos, angle, zoom, z) {
    if (is_object(pos) && (pos.x === undefined)) {
        zoom = pos.zoom;
        angle = pos.angle;
        z = pos.z;
        pos = pos.pos;
    }

    if (pos === undefined) { pos = {x:0, y:0}; }
    if (zoom === undefined) { zoom = 1; }

    if (typeof zoom !== 'number' && typeof zoom !== 'function') {
        $error('zoom argument to set_camera() must be a number or function');
    }
    if (typeof zoom === 'number' && (zoom <= 0 || !(zoom < Infinity))) {
        $error('zoom argument to set_camera() must be positive and finite');
    }
    $camera.x = pos.x;
    $camera.y = pos.y;

    if (pos.z !== undefined && z !== undefined && pos.z !== z) {
        $error('Cannot have different z and pos.z values on a camera');
    }
    
    if (z === undefined) { z = pos.z; }
    if (z === undefined) { z = 0; }
    $camera.has_pos_z = (pos.z !== undefined);

    $camera.z = z;
    $camera.angle = angle || 0;
    $camera.zoom = zoom;
}


function get_camera() {
    return {
        pos: $camera.has_pos_z ? xyz($camera.x, $camera.y, $camera.z) : xy($camera.x, $camera.y),
        angle: $camera.angle,
        zoom: $camera.zoom,
        z: $camera.z
    };
}

function get_transform() {
    return {pos:  xy($offsetX, $offsetY),
            dir:  xy($scaleX, $scaleY),
            z:    $offsetZ,
            z_dir: $scaleZ,
            skew: xy($skewXZ, $skewYZ)
           };
}


function rotation_sign() {
    return -$Math.sign($scaleX * $scaleY);
}


function up_y() {
    return -$Math.sign($scaleY);
}


function reset_transform() {
    $offsetX = $offsetY = $offsetZ = $skewXZ = $skewYZ = 0;
    $scaleX = $scaleY = $scaleZ = 1;
}


function compose_transform(pos, dir, addZ, scaleZ, skew) {
    if (is_object(pos) && (('pos' in pos) || ('dir' in pos) || ('z' in pos) || ('skew' in pos))) {
        // Argument version
        return compose_transform(pos.pos, pos.dir, pos.z, pos.skew);
    }
    let addX, addY, scaleX, scaleY, skewXZ, skewYZ;
    if (pos !== undefined) {
        if (is_number(pos)) { $error("pos argument to compose_transform() must be an xy() or nil"); }
        addX = pos.x; addY = pos.y;
    }
    if (dir !== undefined) { scaleX = dir.x; scaleY = dir.y; }
    if (skew !== undefined) { skewXZ = skew.x; skewYZ = skew.y; }

    // Any undefined fields will default to the reset values
    if (addX === undefined) { addX = 0; }
    if (addY === undefined) { addY = 0; }
    if (addZ === undefined) { addZ = 0; }
    if (scaleX === undefined) { scaleX = 1; }
    if (scaleY === undefined) { scaleY = 1; }
    if (scaleZ === undefined) { scaleZ = 1; }
    if (skewXZ === undefined) { skewXZ = 0; }
    if (skewYZ === undefined) { skewYZ = 0; }

    // Composition derivation under the "new transformation happens first" model:
    //
    // Basic transforms:
    // screen.x = (draw.x + skew.x * draw.z) * dir.x + pos.x
    // screen.y = (draw.y + skew.y * draw.z) * dir.y + pos.y
    // screen.z = draw.z * zDir + z
    //
    // screen.z = (draw.z * zDirNew + addZNew) * zDirOld + addZOld
    //          = draw.z * zDirNew * zDirOld + addZNew * zDirOld + addZOld
    //          = draw.z * (zDirNew * zDirOld) + (addZNew * zDirOld + addZOld)
    //   zAddNet = addZNew * zDirOld + addZOld
    //   zDirNet = zDirNew * zDirOld
    //
    // screen.x = (((draw.x + skewNew.x * draw.z) * dirNew.x + posNew.x) + skew.x * draw.z) * dir.x + pos.x
    //          = (draw.x * dirNew.x + skewNew.x * draw.z * dirNew.x + skew.x * draw.z) * dir.x + posNew.x * dir.x + pos.x
    //          = (draw.x + draw.z * [skewNew.x + skew.x/dirNew.x]) * [dir.x * dirNew.x] + posNew.x * dir.x + pos.x
    //     netAdd.x = posNew.x * dir.x + pos.x
    //     netSkew.x = skewNew.x + skew.x / dirNew.x
    //     netDir.x = dir.x * dirNew.x
    

    // Order matters because these calls mutate the parameters.
    $offsetX = addX * $scaleX + $offsetX;
    $skewXZ  = skewXZ + $skewXZ / $scaleX;
    $scaleX  = scaleX * $scaleX;

    $offsetY = addY * $scaleY + $offsetY;
    $skewYZ  = skewYZ + $skewYZ / $scaleY;
    $scaleY  = scaleY * $scaleY;
    
    $offsetZ = addZ * $scaleZ + $offsetZ;
    $scaleZ  = scaleZ * $scaleZ;    
}


function set_transform(pos, dir, addZ, scaleZ, skew) {
    if (arguments.length === 0) { $error("set_transform() called with no arguments"); }
    if (is_object(pos) && (('pos' in pos) || ('dir' in pos) || ('z' in pos) || ('z_dir' in pos) || ('skew' in pos))) {
        // Argument version
        return set_transform(pos.pos, pos.dir, pos.z, pos.z_dir, pos.skew);
    }

    let addX, addY, scaleX, scaleY, skewXZ, skewYZ;
    if (pos !== undefined) {
        if (is_number(pos)) { $error("pos argument to set_transform() must be an xy() or nil"); }
        addX = pos.x; addY = pos.y;
    }
    if (dir !== undefined) { scaleX = dir.x; scaleY = dir.y; }
    if (skew !== undefined) { skewXZ = skew.x; skewYZ = skew.y; }

    // Any undefined fields will default to their previous values
    if (addX === undefined) { addX = $offsetX; }
    if (addY === undefined) { addY = $offsetY; }
    if (addZ === undefined) { addZ = $offsetZ; }
    if (scaleX === undefined) { scaleX = $scaleX; }
    if (scaleY === undefined) { scaleY = $scaleY; }
    if (scaleZ === undefined) { scaleZ = $scaleZ; }
    if (skewXZ === undefined) { skewXZ = $skewXZ; }
    if (skewYZ === undefined) { skewYZ = $skewYZ; }

    if (isNaN(addX) || isNaN(addY) || isNaN(addZ)) { $error('NaN in transform pos'); }
    if (isNaN(scaleX) || isNaN(scaleY) || isNaN(scaleZ)) { $error('NaN in transform scale'); }
    if (isNaN(skewXZ) || isNaN(skewYZ)) { $error('NaN in transform skew'); }
    
    $offsetX = addX;
    $offsetY = addY;
    $offsetZ = addZ;

    $scaleX = (scaleX === -1) ? -1 : +1;
    $scaleY = (scaleY === -1) ? -1 : +1;
    $scaleZ = (scaleZ === -1) ? -1 : +1;

    $skewXZ = skewXZ;
    $skewYZ = skewYZ;
}


function intersect_clip(corner, size, z1, z_size) {
    if (corner && (corner.corner || corner.size || (corner.z !== undefined) || (corner.z_size !== undefined))) {
        return intersect_clip(corner.corner, corner.size, corner.z, corner.z_size);
    }

    let x1, y1, dx, dy, dz;
    if (corner !== undefined) {
        if (is_number(corner)) { $error('corner argument to set_clip() must be an xy() or nil'); }
        x1 = corner.x; y1 = corner.y;
    }
    if (size !== undefined) {
        if (is_number(size)) { $error('size argument to set_clip() must be an xy() or nil'); }
        dx = size.x; dy = size.y;
    }
    
    if (x1 === undefined) { x1 = $clipX1; }
    if (y1 === undefined) { y1 = $clipY1; }
    if (z1 === undefined) { z1 = $clipZ1; }
    if (dx === undefined) { dx = $clipX2 - $clipX1 + 1; }
    if (dy === undefined) { dy = $clipY2 - $clipY1 + 1; }
    if (dz === undefined) { dz = $clipZ2 - $clipZ1 + 1; }

    let x2 = x1 + dx, y2 = y1 + dy, z2 = z1 + dz;

    // Order appropriately
    if (x2 < x1) { let temp = x1; x1 = x2; x2 = temp; }
    if (y2 < y1) { let temp = y1; y1 = y2; y2 = temp; }
    if (z2 < z1) { let temp = z1; z1 = z2; z2 = temp; }
    
    x1 = $Math.round(x1);
    y1 = $Math.round(y1);
    z1 = $Math.round(z1);

    x2 = $Math.floor(x2 - 0.5);
    y2 = $Math.floor(y2 - 0.5);
    z2 = $Math.floor(z2 - 0.5);

    $clipX1 = $clamp($Math.max(x1, $clipX1), 0, $SCREEN_WIDTH - 1);
    $clipY1 = $clamp($Math.max(y1, $clipY1), 0, $SCREEN_HEIGHT - 1);
    $clipZ1 = $clamp($Math.max(z1, $clipZ1), -2047, 2048);
    
    $clipX2 = $clamp($Math.min(x2, $clipX2), 0, $SCREEN_WIDTH - 1);
    $clipY2 = $clamp($Math.min(y2, $clipY2), 0, $SCREEN_HEIGHT - 1);
    $clipZ2 = $clamp($Math.min(z2, $clipZ2), -2047, 2048);
}


function reset_clip() {
    $clipX1 = $clipY1 = 0;
    $clipZ1 = -2047;
    $clipX2 = $SCREEN_WIDTH - 1;
    $clipY2 = $SCREEN_HEIGHT - 1;
    $clipZ2 = 2048;
}


function get_clip() {
    return {
        corner:  {x:$clipX1, y:$clipY1},
        size:    {x:$clipX2 - $clipX1 + 1, y:$clipY2 - $clipY1 + 1},
        z:       $clipZ1,
        z_size:  $clipZ2 - $clipZ1 + 1
    };
}


function set_clip(corner, size, z1, dz) {
    if (corner && (corner.corner || corner.size || (corner.z !== undefined) || (corner.z_size !== undefined))) {
        return set_clip(corner.corner, corner.size, corner.z, corner.z_size);
    }
    
    let x1, y1, dx, dy;
    if (corner !== undefined) {
        if (is_number(corner)) { $error('corner argument to set_clip() must be an xy() or nil'); }
        x1 = corner.x; y1 = corner.y;
    }
    if (size !== undefined) {
        if (is_number(size)) { $error('size argument to set_clip() must be an xy() or nil'); }
        dx = size.x; dy = size.y;
    }
    
    if (x1 === undefined) { x1 = $clipX1; }
    if (y1 === undefined) { y1 = $clipY1; }
    if (z1 === undefined) { z1 = $clipZ1; }
    if (dx === undefined) { dx = $clipX2 - $clipX1 + 1; }
    if (dy === undefined) { dy = $clipY2 - $clipY1 + 1; }
    if (dz === undefined) { dz = $clipZ2 - $clipZ1 + 1; }

    let x2 = x1 + dx, y2 = y1 + dy, z2 = z1 + dz;

    // Order appropriately
    if (x2 < x1) { let temp = x1; x1 = x2; x2 = temp; }
    if (y2 < y1) { let temp = y1; y1 = y2; y2 = temp; }
    if (z2 < z1) { let temp = z1; z1 = z2; z2 = temp; }
    
    x1 = $Math.round(x1);
    y1 = $Math.round(y1);
    z1 = $Math.round(z1);

    x2 = $Math.floor(x2 - 0.5);
    y2 = $Math.floor(y2 - 0.5);
    z2 = $Math.floor(z2 - 0.5);

    $clipX1 = $clamp(x1, 0, $SCREEN_WIDTH - 1);
    $clipY1 = $clamp(y1, 0, $SCREEN_HEIGHT - 1);
    $clipZ1 = $clamp(z1, -2047, 2048);
    
    $clipX2 = $clamp(x2, 0, $SCREEN_WIDTH - 1);
    $clipY2 = $clamp(y2, 0, $SCREEN_HEIGHT - 1);
    $clipZ2 = $clamp(z2, -2047, 2048);
}


function abs(x) {
    return (x.length !== undefined) ? x.length : $Math.abs(x);
}

var sin = $Math.sin;
var cos = $Math.cos;
var tan = $Math.tan;
var acos = $Math.acos;
var asin = $Math.asin;
var log = $Math.log;
var log2 = $Math.log2;
var log10 = $Math.log10;
var exp = $Math.exp;
var sqrt = $Math.sqrt;
var cbrt = $Math.cbrt;

function sign_nonzero(x) { return (x < 0) ? -1 : 1; }

function atan(y, x) {
    if (typeof y === 'number') { return $Math.atan2(y, x); }
    return $Math.atan2(y.y, y.x);
}


/* If x is very close to an integer, make it the integer */
function $snap_epsilons_to_integer(x) {
    const int_x = $Math.round(x)
    if ((x !== int_x) && ($Math.abs(x - int_x) < 1e-12)) {
        return int_x;
    } else {
        return x;
    }
}

function angle_to_xy(angle) {
    return {
        x: $snap_epsilons_to_integer($Math.cos(angle)),
        y: $snap_epsilons_to_integer(rotation_sign() * $Math.sin(angle))
    };
}

function xy_to_angle(v) {
    if ($Math.abs(v.x) < 1e-10 && $Math.abs(v.y) < 1e-10) {
        return 0;
    } else {
        return rotation_sign() * $Math.atan2(v.y, v.x);
    }
}


// Directly exposed to quadplay
function midi_send_raw(port, message) {
    if (! port && port.$port) {
        $error('Not a MIDI output port');
    }

    if (!Array.isArray(message)) {
        $error('The message must be an array of 8-bit integers');
    }

    if (port.$port.state !== 'connected') {
        return 'MIDI port no longer connected';
    }

    if (port.$port.connection !== 'open') {
        // Open the port
        port.$port.open().then(function () {
            midi_send_raw(port, message);
        });
    } else {
        try {
            port.$port.send(message);
        } catch (e) {
            return e.message;
        }
    }
    
    return 'ok';
}


function $hash(d) {
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
        $hashview.setFloat64(0, d);
        for (var i = 7; i >= 0; --i) {
            hval ^= $hashview.getUint8(i);
            hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
        }

        // Near integers, FNV sometimes does a bad job because it doesn't
        // mix the low bits enough. XOR with some well-distributed
        // bits
        hval ^= ($fract($Math.sin(d * 10) * 1e6) * 0xffffffff) | 0;
    }
    
    // Force to unsigned 32-bit
    return (hval >>> 0);
}


function hash(x, y) {
    var h = $hash(x);
    if (y !== undefined) {
        var hy = $hash(y);
        h ^= ((hy >> 16) & 0xffff) | ((hy & 0xffff) << 16);
    }
    
    return $Math.abs(h) / 0xffffffff;
}

function $lerp(a, b, t) { return a * (1 - t) + b * t; }

// Unoptimized:
//function $nhash1(n) { n = $Math.sin(n) * 1e4; return n - $Math.floor(n); }

// Fast 1D numerical "hash" used by noise()
function $nhash1(x) {
    x %= 6.28318531;

    let s = 1.27323954 * x;
    const k = 0.405284735 * x * x;
    if (x < 0) s += k; else s -= k;

    // At this point, s is a fast, bad approximation of sin(x)

    /*
    // Correction factor (if we wanted more precision; costs another 10%)
    const c = 0.225 * (s * s + s);
    if (s < 0) s -= c; else s += c;
    */

    // At this point, s is a fast, good approximation of sin(x)

    // Extract the lower decimal places, which are approximately
    // uniformly distributed and on the range [0, 1)
    s *= 1e4;
    return s - $Math.floor(s);
}


// bicubic fbm value noise
// from https://www.shadertoy.com/view/4dS3Wd
function noise(octaves, x, y, z) {
    if (Array.isArray(x)) {
        z = x[2];
        y = x[1];
        x = x[0];
    } else if (x.x !== undefined) {
        z = x.z;
        y = x.y;
        x = x.x;
    }
    
    // Set any missing axis to zero
    x = x || 0;
    y = y || 0;
    z = z || 0;

    let temp = $Math.round(octaves);
    if (octaves - temp > 1e-10) {
        // Catch the common case where the order of arguments was swapped
        // by recognizing fractions in the octave value
        $error("noise(octaves, x, y, z) must take an integer number of octaves");
    } else {
        octaves = temp >>> 0;
    }

    octaves = $Math.max(1, octaves);
    
    // Maximum value is 1/2 + 1/4 + 1/8 ... from the straight summation.
    // The max is always pow(2, -octaves) less than 1.
    // So, divide each term by (1-pow(2,-octaves)) as well as
    // its octave scaling.
    //
    // UNoptimized: k = 1 / (1 - $Math.pow(2, -octaves));
    let v = 0, k = 1 / (1 - 1 / (1 << octaves));
    
    const stepx = 110, stepy = 241, stepz = 171;

    if ($Math.abs(z) > 1e-8) {
        // Full 3D
    
        for (; octaves > 0; --octaves) {        
            const ix = $Math.floor(x), iy = $Math.floor(y), iz = $Math.floor(z);
            const fx = x - ix,         fy = y - iy,         fz = z - iz;
            
            // For performance, compute the base input to a 1D hash
            // from the integer part of the argument and the
            // incremental change to the 1D based on the 3D -> 1D
            // wrapping
            const n = ix * stepx + iy * stepy + iz * stepz;
            
            const ux = fx * fx * (3 - 2 * fx),
                  uy = fy * fy * (3 - 2 * fy),
                  uz = fz * fz * (3 - 2 * fz);
            
            v += ($lerp($lerp($lerp($nhash1(n), $nhash1(n + stepx), ux),
                              $lerp($nhash1(n + stepy), $nhash1(n + stepx + stepy), ux), uy),
                        $lerp($lerp($nhash1(n + stepz), $nhash1(n + stepx + stepz), ux),
                              $lerp($nhash1(n + stepy + stepz), $nhash1(n + stepx + stepy + stepz), ux), uy), uz) - 0.5) * k;
            
            // Grab successive octaves from very different parts of
            // the space, and double the frequency
            x += x + 109;
            y += y + 31;
            z += z + 57;
            k *= 0.5;
        }
    } else {
        // Optimized 2D, where the z terms will all be zero. See above for implementation comments.
        x = Math.fround(x);
        y = Math.fround(y);
        for (; octaves > 0; --octaves) {     
            const ix = $Math.floor(x), iy = $Math.floor(y);
            const fx = x - ix, fy = y - iy;
            const n = ix * stepx + iy * stepy;
            
            const ux = fx * fx * (3 - fx - fx),
                  uy = fy * fy * (3 - fy - fy);

            v += ($lerp($lerp($nhash1(n),         $nhash1(n + stepx),         ux),
                        $lerp($nhash1(n + stepy), $nhash1(n + stepx + stepy), ux), uy) - 0.5) * k;

            x += x + 109;
            y += y + 31;
            k *= 0.5;
        }
    }
    
    return v;
}


function $noop() {}


function vec(x, y, z, w) {
    if (w !== undefined) {
        return {x:x, y:y, z:z, w:w}
    } else if (z !== undefined) {
        return {x:x, y:y, z:z}
    } else {
        return {x:x, y:y}
    }
}

function $error(msg) {
    throw new Error(msg);
}


function $todo(msg) {
    if (msg === undefined) {
        $error("Unimplemented");
    } else {
        $error("Unimplemented: " + $unparse(msg));
    }
}


function xy(x, y) {
    if (x === undefined || x === null) {
        if (arguments.length > 0) {
            $error('no argument to xy()');
        } else {
            $error('nil argument to xy()');
        }
    }
    
    if (x.x !== undefined) {
        if (y !== undefined) { $error('xy(number, number), xy(xy), xy(xyz), or xy(array) are the only legal options'); }
        // Vector clone or stripping
        return {x:x.x, y:x.y};
    }
    if (Array.isArray(x)) { return {x:x[0], y:x[1]}; }
    if (typeof x !== 'number') { $error('The first argument to xy(x, y) must be a number (was ' + unparse(x) + ')'); }
    if (typeof y !== 'number') { $error('The second argument to xy(x, y) must be a number (was ' + unparse(y) + ')'); }
    if (arguments.length !== 2) { $error('xy() cannot take ' + arguments.length + ' arguments.'); }

    // Common case, after all of the special and error cases have been considered
    return {x:x, y:y};
}

function xz_to_xyz(v, new_z) {
    return {x:v.x, y: v.z, z: new_z || 0};
}

function xy_to_xyz(v, z) {
    return {x:v.x, y: v.y, z: z || 0};
}

function xz(x, z) {
    if (x === undefined) {
        $error('nil or no argument to xz()');
    }
    
    if (x.x !== undefined) { // xz(xyz)
        if (z !== undefined) { $error('xz(number, number), xz(xz), xz(xyz), or xz(array) are the only legal options'); }
        return {x:x.x, z:x.z};
    }
    if (Array.isArray(x)) { return {x:x[0], z:x[1]}; }
    if (arguments.length !== 2) { $error('xz() cannot take ' + arguments.length + ' arguments.'); }
    if (typeof z !== 'number') { $error('The second argument to xz(x, z) must be a number'); }
    return {x:x, z:z};
}


function xy_to_xz(v) {
    return {x: v.x, z: v.y};
}


function xz_to_xy(v) {
    return {x: v.x, y: v.z};
}


function xyz(x, y, z) {
    if (x.x !== undefined) {
        if (x.z !== undefined) { 
            if (x.y === undefined) { // xyz(xz)
                return {x:x.x, y:(y === undefined ? 0 : y), z:x.z};
            } else { // xyz(xyz) {
                if (y !== undefined) { $error('Cannot run xyz(xyz, z)'); }
                return {x:x.x, y:x.y, z:x.z};
            }
        } else { // xyz(xy, y default 0)
            return {x:x.x, y:x.y, z:(y === undefined ? 0 : y)}
        }
    }
    if (Array.isArray(x)) { return {x:x[0], y:x[1], z:x[2]}; }
    if (arguments.length !== 3) { $error('xyz() requires exactly three arguments'); }
    return {x:x, y:y, z:z};
}


function rgb_to_xyz(c) {
    return {x:c.r, y:c.g, z:c.b};
}


function xyz_to_rgb(v) {
    return {r: v.x, g: v.y, b: v.z};
}


function equivalent(a, b) {
    switch (typeof a) {
    case 'number':
        if (is_nan(a) && is_nan(b)) {
            return true;
        }
        // fall through
        
    case 'string':
    case 'function':
    case 'boolean':
    case 'undefined':
        return a === b;
        
    default:
        if (b === undefined) { return false; }
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
    if (arguments.length !== 3 && arguments.length !== 1) { $error('rgb() requires exactly one or three arguments or one hsv value'); }

    if (Array.isArray(r)) {
        b = r[2];
        g = r[1];
        r = r[0];
    }

    if (r.h !== undefined) {
        // Convert HSV --> RGB
        const h = $loop(r.h, 0, 1), s = $clamp(r.s, 0, 1), v = $clamp(r.v, 0, 1);
        let k = (5 + 6 * h) % 6;
        r = v - v * s * $Math.max(0, $Math.min(k, 4 - k, 1));

        k = (3 + 6 * h) % 6;
        g = v - v * s * $Math.max(0, $Math.min(k, 4 - k, 1));

        k = (1 + 6 * h) % 6;
        b = v - v * s * $Math.max(0, $Math.min(k, 4 - k, 1));
        /*
        r = v * (1 - s + s * $clamp($Math.abs($fract(h +  1 ) * 6 - 3) - 1, 0, 1));
        g = v * (1 - s + s * $clamp($Math.abs($fract(h + 2/3) * 6 - 3) - 1, 0, 1));
        b = v * (1 - s + s * $clamp($Math.abs($fract(h + 1/3) * 6 - 3) - 1, 0, 1));
        */
    } else if (r.r !== undefined) {
        // Clone
        g = r.g;
        b = r.b;
        r = r.r;
    } else if (r.$color !== undefined) {
        return rgb(rgba(r.$color));
    } else if (typeof r === 'string' && r[0] === '#') {
        return rgb($parseHexColor(r.substring(1)));
    } else {
        r = $clamp(r, 0, 1);
        g = $clamp(g, 0, 1);
        b = $clamp(b, 0, 1);
    }
    
    return {r:r, g:g, b:b};
}


function rgba(r, g, b, a) {
    if (Array.isArray(r)) {
        a = r[3];
        b = r[2];
        g = r[1];
        r = r[0];
    }
   
    if (r.h !== undefined) {
        // Convert to RGB
        const c = rgb(r);

        // add a
        if (r.a !== undefined) {
            c.a = r.a;
        } else {
            c.a = (g === undefined ? 1 : g);
        }
        return c;
    } else if (r.r !== undefined) {
        // Clone, maybe overriding alpha
        a = (r.a === undefined) ? (g === undefined ? 1 : g) : r.a;
        g = r.g;
        b = r.b;
        r = r.r;
    } else if (r.$color !== undefined) {
        const c = r.$color;
        r = (c & 0xf) * (1 / 15);
        g = ((c >> 4) & 0xf) * (1 / 15);
        b = ((c >> 8) & 0xf) * (1 / 15);
        a = ((c >>> 12) & 0xf) * (1 / 15);
    } else if (typeof r === 'string' && r[0] === '#') {
        return rgba($parseHexColor(r.substring(1)));
    } else {
        r = $clamp(r, 0, 1);
        g = $clamp(g, 0, 1);
        b = $clamp(b, 0, 1);
        a = $clamp(a, 0, 1);
    }
    
    return {r:r, g:g, b:b, a:a};
}


function hsv(h, s, v) {
    if (Array.isArray(h)) {
        v = h[2];
        s = h[1];
        h = h[0];
    }
    
    if (h.r !== undefined) {
        // Convert RGB -> HSV
        const r = $clamp(h.r, 0, 1), g = $clamp(h.g, 0, 1), b = $clamp(h.b, 0, 1);

        v = $Math.max(r, g, b);

        if (v <= 0) {
            // Black
            h = 0; s = 0;
        } else {
            const lowest = $Math.min(r, g, b);

            // (highest - lowest) / highest = 1 - lowest / v
            s = 1 - lowest / v;
            const diff = v - lowest;

            if (diff > 0) {
                // Choose range based on which is the highest
                if (r === v)      { h =     (g - b) / diff; } // between yellow & magenta
                else if (g === v) { h = 2 + (b - r) / diff; } // between cyan & yellow
                else              { h = 4 + (r - g) / diff; } // between magenta & cyan
            } else {
                h = 0;
            }
            
            h /= 6;
            if (h < 0) { h += 1; }
        }
    } else if (h.h !== undefined) {
        // Clone hsv or hsva -> hsv
        v = h.v;
        s = h.s;
        h = h.h;
    } else if (h.$color) {
        return hsv(rgb(h));
    }

    return {h:h, s:s, v:v};
}


function hsva(h, s, v, a) {
    if (Array.isArray(h)) {
        a = h[3];
        v = h[2];
        s = h[1];
        h = h[0];
    }
    
    if (h.r !== undefined) {
        const c = hsv(h);
        c.a = (h.a !== undefined) ? h.a : 1;
        return c;
    } else if (h.h !== undefined) {
        // Clone, or hsv -> hsva
        a = (h.a === undefined) ? 1 : h.a;
        v = h.v;
        s = h.s;
        h = h.h;
    } else if (h.$color !== undefined) {
        return hsva(rgba(r));
    }
    
    return {h:h, s:s, v:v, a:a};
}


$Math.mid = function(a, b, c) {
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

function $lerp(x, y, a) { return (1 - a) * x + a * y; }
function $clamp(x, lo, hi) { return $Math.min($Math.max(x, lo), hi); }
function $fract(x) { return x - $Math.floor(x); }
function $square(x) { return x * x; }

/*************************************************************************************/
// Entity functions

function transform_es_to_sprite_space(entity, coord) {
    if (! entity || entity.pos === undefined |! coord || coord.x === undefined) { $error("Requires both an entity and a coordinate"); }
    return xy(coord.x * $scaleX + entity.sprite.size.x * 0.5,
              coord.y * $scaleY + entity.sprite.size.y * 0.5);
}


function transform_sprite_space_to_es(entity, coord) {
    if (! entity || entity.pos === undefined |! coord || coord.x === undefined) { $error("Requires both an entity and a coordinate"); }
    if (! entity.sprite) { $error('Called transform_sprite_space_to_es() on an entity with no sprite property.'); }
    return xy((coord.x - entity.sprite.size.x * 0.5) / $scaleX,
              (coord.y - entity.sprite.size.y * 0.5) / $scaleY);
}


function draw_entity(e, recurse) {
    if (e === undefined) { $error("nil entity in draw_entity()"); }
    if (recurse === undefined) { recurse = true; }

    if ($showEntityBoundsEnabled) {
        draw_bounds(e, false);
        draw_text({font: $font5, text: e.name, pos: e.pos, color: rgb(1,1,1), outline: rgb(0,0,0), z: e.z + 0.001});
    }
    
    if (e.sprite) {
        // Shift the transform temporarily to support the offset without
        // memory allocation
        const oldX = $offsetX, oldY = $offsetY;
        $offsetX += e.offset.x * $scaleX; $offsetY += e.offset.y * $scaleY;
        draw_sprite(e.sprite, e.pos, e.angle, e.scale, e.opacity, e.z, e.override_color, undefined, e.pivot);
        $offsetX = oldX; $offsetY = oldY;
    }

    if (e.child_array && recurse) {
        const N = e.child_array.length;
        for (let i = 0; i < N; ++i) {
            draw_entity(e.child_array[i], recurse);
        }
    }

    if (e.font && e.text) {
        const oldX = $offsetX, oldY = $offsetY;
        $offsetX += (e.offset.x + (e.text_offset ? e.text_offset.x : 0)) * $scaleX; $offsetY += (e.offset.y + (e.text_offset ? e.text_offset.y : 0)) * $scaleY;
        draw_text(e.font, e.text, e.pos, e.text_color || rgb(1, 1, 1), e.text_shadow, e.text_outline, e.text_x_align, e.text_y_align, e.z);
        $offsetX = oldX; $offsetY = oldY;
    }
}


// Not public because it isn't a very good test yet.
function $isEntity(e) {
    return e.shape && e.pos && e.vel && e.force;
}

// https://en.wikipedia.org/wiki/Centroid#Of_a_polygon
function $poly_centroid(vertex) {
    console.assert(vertex.length >= 3, "shape must have at least three vertices");
    const centroid = {x: 0, y: 0};
    let signedDoubleArea = 0;

    for (let i = 0; i < vertex.length; ++i) {
        const A = vertex[i];
        const B = vertex[(i + 1) % vertex.length];
        
        const doubleArea = A.x * B.y - B.x * A.y;
        
        signedDoubleArea += doubleArea;
        centroid.x += (A.x + B.x) * doubleArea;
        centroid.y += (A.y + B.y) * doubleArea;
    }

    const norm = 3 * signedDoubleArea;
    console.assert(Math.abs(norm) > 0, 'Shape must have nonzero area');
    
    centroid.x /= norm;
    centroid.y /= norm;

    return centroid;
}


var $entityID = 0;
function make_entity(e, childTable) {
    const r = Object.assign({}, e || {});    

    if (e.shape && (e.shape !== 'rect') && (e.shape !== 'disk') && ! is_array(e.shape)) {
        $error('Illegal shape for entity: "' + e.shape + '"');
    }

    // Clone vector components. If pos is an xyz(), use xyz() for other
    // terms
    r.pos = r.pos ? clone(r.pos) : xy(0, 0);
    r.vel = r.vel ? clone(r.vel) : $mul(clone(r.pos), 0);
    r.force = r.force ? clone(r.force) : $mul(clone(r.pos), 0);

    r.restitution = (r.restitution === undefined) ? 0.1 : r.restitution;
    r.friction    = (r.friction === undefined) ? 0.15 : r.friction;
    r.drag        = (r.drag === undefined) ? 0.005 : r.drag;
    r.stiction_factor = (r.stiction_factor === undefined) ? 1 : r.stiction_factor;

    r.angle = r.angle || 0;
    r.spin = r.spin || 0;
    r.torque = r.torque || 0;
    
    r.override_color = clone(r.override_color);
    
    r.scale = r.scale ? clone(r.scale) : xy(1, 1);
    r.offset = r.offset ? clone(r.offset) : xy(0, 0);
    
    // Assign empty fields with reasonable defaults
    r.name = r.name || ('entity' + ($entityID++));
    r.shape = r.shape || 'rect';
    r.sprite = r.sprite || undefined;

    if (r.sprite && ! r.sprite.$spritesheet && r.sprite.$uint16Data) {
        // Replace the whole spritesheet with element 0
        r.sprite = r.sprite[0][0];
    }
        
    if (r.pos.z === undefined) {
        // Only set r.z if r.pos.z is undefined or
        // r.z is explicitly set.
        r.z = r.z || 0;
    }

    r.physics_sleep_state = r.physics_sleep_state || 'awake';

    r.text_x_align = r.text_x_align || "center";
    r.text_y_align = r.text_y_align || "center";

    r.contact_group = r.contact_group || 0;
    r.contact_category_mask = (r.contact_category_mask === undefined) ? 1 : r.contact_category_mask;
    r.contact_hit_mask = (r.contact_hit_mask === undefined) ? 0xffffffff : r.contact_hit_mask;
    r.is_sensor = (r.is_sensor === undefined) ? false : r.is_sensor;

    if (r.density === undefined) { r.density = 1; }
    
    if (r.opacity === undefined) { r.opacity = 1; }
    
    if (typeof r.scale === 'number') {
        r.scale = {x: r.scale, y: r.scale};
    }
    if (typeof r.scale !== 'object') {
        $error('The scale of an entity must be a number or xy().');
    }
    
    if (r.size === undefined) {
        if (r.sprite) {
            if (r.shape === 'rect' || is_array(r.shape)) {
                r.size = {x: r.sprite.size.x, y: r.sprite.size.y};
            } else if (r.shape === 'disk') {
                const x = min_value(r.sprite.size);
                r.size = xy(x, x);
                if ($Math.abs(r.scale.x) !== $Math.abs(r.scale.y)) {
                    $error('Cannot have different magnitude scale factors for x and y on a "disk" shaped entity.');
                }
            }
        } else {
            // no size, no sprite
            r.size = xy(0, 0);
        }
    } else {
        r.size = clone(r.size);
    }

    if (is_nan(r.size.x)) { $error('nan entity.size.x'); }
    if (is_nan(r.size.y)) { $error('nan entity.size.y'); }

    if (r.pivot === undefined) {
        if (r.sprite) {
            r.pivot = clone(r.sprite.pivot);
        } else {
            r.pivot = xy(0, 0);
        }
    } else {
        r.pivot = clone(r.pivot);
    }

    if (is_array(e.shape)) {
        // Center the shape and then correct the pivot and size
        const centroid = $poly_centroid(r.shape);
        const poly = r.shape;
        console.assert(! is_NaN(centroid.x) && is_number(centroid.x));
        r.shape = [];

        // Recompute size
        r.size.x = 0; r.size.y = 0;
        
        // Move the polygon
        for (let v of poly) {
            const newV = {x: v.x - centroid.x, y: v.y - centroid.y};
            r.shape.push(newV);
            r.size.x = Math.max(2 * Math.abs(newV.x), r.size.x);
            r.size.y = Math.max(2 * Math.abs(newV.y), r.size.y);
        }

        // Move the pivot so that the sprite alignment does not change
        r.pivot.x += centroid.x;
        r.pivot.y += centroid.y;
    }

    const child_array = r.child_array ? clone(r.child_array) : [];
    r.child_array = [];
    if (r.orient_with_parent === undefined) { r.orient_with_parent = true; }
    if (r.offset_with_parent === undefined) { r.offset_with_parent = true; }
   
    r.z_in_parent = r.z_in_parent || 0;
    r.pos_in_parent = r.pos_in_parent ? clone(r.pos_in_parent) : xy(0, 0);
    r.angle_in_parent = r.angle_in_parent || 0;
    r.offset_in_parent = r.offset_in_parent ? clone(r.offset_in_parent) : xy(0, 0);
    r.scale_in_parent = r.scale_in_parent ? clone(r.scale_in_parent) : xy(1, 1);

    if (is_number(r.scale_in_parent)) {
        r.scale_in_parent = xy(r.scale_in_parent, r.scale_in_parent);
    }

    if (is_nan(r.angle)) { $error('nan angle on entity'); }
    if (r.z !== undefined && is_nan(r.z)) { $error('nan z on entity'); }
    
    // Construct named children
    if (childTable) {
        for (let name in childTable) {
            const child = childTable[name];
            if (! $isEntity(child)) {
                $error('The child named "' + name + '" in the childTable passed to make_entity is not itself an entity');
            }
            
            r[name] = child;
            if (child.name === 'Anonymous') {
                child.name = name;
            }
            child_array.push(child)
        }
    }

    // Add and update all children
    for (let i = 0; i < child_array.length; ++i) {
        entity_add_child(r, child_array[i]);
    }
    entity_update_children(r);
    
    return r;
}


function entity_add_child(parent, child) {
    if (! child) { return child; }
    
    entity_remove_child(parent, child);
    
    child.parent = parent;
    // Avoid accidental duplicates
    if (parent.child_array.indexOf(child) === -1) {
        parent.child_array.push(child);
    }
    
    return child;
}


function entity_remove_all(parent) {
    for (let i = 0; i < parent.child_array.length; ++i) {
        const child = parent.child_array[i];
        if (parent !== child.parent) {
            $error('Tried to remove a child from the wrong parent')
        }
        remove_values(child.parent.child_array, child);
        if (parent.child_array[i] === child) {
            $error('Tried to remove a child that did not have a pointer back to its parent');
        }
    }
}


function entity_remove_child(parent, child) {
    if (! child) { return child; }
    
    if (child.parent) {
        if (parent !== child.parent) { $error('Tried to remove a child from the wrong parent'); }
        remove_values(parent.child_array, child);
    } else if (parent.child_array.indexOf(child) !== -1) {
        $error('Tried to remove a child that did not have a pointer back to its parent');
    }
    
    child.parent = undefined;
    return child;
}


function transform_es_to_es(entity_from, entity_to, point) {
    return transform_ws_to_es(entity_to, transform_es_to_ws(entity_from, point));
}


function transform_cs_to_ss(cs_point, cs_z) {
    cs_z = cs_z || 0;
    return xy((cs_point.x + (cs_z * $skewXZ)) * $scaleX + $offsetX,
              (cs_point.y + (cs_z * $skewYZ)) * $scaleY + $offsetY);
}


function transform_ss_to_cs(ss_point, ss_z) {
    ss_z = ss_z || 0;
    const cs_z = transform_ss_z_to_cs_z(ss_z);
    return xy((ss_point.x - $offsetX) / $scaleX - cs_z * $skewXZ,
              (ss_point.y - $offsetY) / $scaleY - cs_z * $skewYZ);
}


function transform_ss_to_ws(ss_point, ss_z) {
    ss_z = ss_z || 0;
    const cs_z = transform_ss_z_to_cs_z(ss_z);
    return transform_cs_to_ws(transform_ss_to_cs(ss_point, ss_z), cs_z);
}


function transform_ws_to_ss(ws_point, ws_z) {
    ws_z = ws_z || 0;
    return transform_cs_to_ss(transform_ws_to_cs(ws_point, ws_z),
                              transform_ws_z_to_cs_z(ws_z));
}

function transform_ws_z_to_cs_z(ws_z) {
    return ws_z - $camera.z;
}

function transform_cs_z_to_ws_z(cs_z) {
    return cs_z + $camera.z;
}

function transform_cs_z_to_ss_z(cs_z) {
    return cs_z * $scaleZ + $offsetZ;
}

function transform_ss_z_to_cs_z(ss_z) {
    return (ss_z - $offsetZ) / $scaleZ;
}

function transform_ws_z_to_ss_z(ws_z) {
    return transform_cs_z_to_ss_z(transform_ws_z_to_cs_z(ws_z));
}

function transform_ws_to_cs(ws_point, ws_z) {
    const cs_z = (ws_z || 0) - $camera.z;
    const mag = $zoom(cs_z);
    const C = $Math.cos($camera.angle) * mag, S = $Math.sin($camera.angle * rotation_sign()) * mag;
    const x = ws_point.x - $camera.x, y = ws_point.y - $camera.y;
    return {x: x * C + y * S, y: y * C - x * S};
}

function transform_cs_to_ws(cs_point, cs_z) {
    const mag = 1 / $zoom(cs_z);
    const C = $Math.cos(-$camera.angle) * mag, S = $Math.sin(-$camera.angle * rotation_sign()) * mag;
    
    const x = cs_point.x - $camera.x, y = cs_point.y - $camera.y;
    return {x: cs_point.x * C + cs_point.y * S + $camera.x,
            y: cs_point.y * C - cs_point.x * S + $camera.y};
}

function transform_ws_to_es(entity, coord) {
    if (! entity || entity.pos === undefined |! coord || coord.x === undefined) { $error("Requires both an entity and a coordinate"); }
    return transform_to(entity.pos, entity.angle, entity.scale, coord);
}


function transform_es_to_ws(entity, coord) {
    if (! coord || coord.x === undefined) { $error("transform_es_to_ws() requires both an entity and a coordinate"); }
    return transform_from(entity.pos, entity.angle, entity.scale, coord);
}


function transform_to_child(child, pos) {
    const a = child.parent.angle - child.angle;
    const c = $Math.cos(a);
    const s = $Math.sin(a);
    const x = pos.x - child.pos_in_parent.x;
    const y = pos.y - child.pos_in_parent.y;
    
    return xy( c * x + s * y,
              -s * x + c * y)
}

function transform_to_parent(child, pos) {
    const a = child.angle - child.parent.angle;
    const c = $Math.cos(a);
    const s = $Math.sin(a);
    return xy( c * pos.x + s * pos.y + child.pos_in_parent.x,
              -s * pos.x + c * pos.y + child.pos_in_parent.y)
}


// Recursively update all properties of the children
function entity_update_children(parent) {
    if (parent === undefined || parent.pos === undefined) {
        $error('entity_update_children requires an entity argument')
    }

    if (typeof parent.scale !== 'object') { $error('The scale of the parent entity must be an xy().'); }
    if (is_nan(parent.angle)) { $error('nan angle on parent entity'); }
    if (parent.z !== undefined && is_nan(parent.z)) { $error('nan z on parent entity'); }
    
    const N = parent.child_array.length;
    const rotSign = $Math.sign(parent.scale.x * parent.scale.y);
    const a = parent.angle * rotation_sign() * rotSign;
    const c = $Math.cos(a), s = $Math.sin(a);
    
    for (let i = 0; i < N; ++i) {
        const child = parent.child_array[i];

        if (child.orient_with_parent) {
            child.scale.x = parent.scale.x * child.scale_in_parent.x;
            child.scale.y = parent.scale.y * child.scale_in_parent.y;
            child.angle   = parent.angle + child.angle_in_parent * rotSign;
        }
       
        child.pos.x = (c * child.pos_in_parent.x - s * child.pos_in_parent.y) * parent.scale.x + parent.pos.x;
        child.pos.y = (s * child.pos_in_parent.x + c * child.pos_in_parent.y) * parent.scale.y + parent.pos.y;
        if (child.pos.z !== undefined) {
            if (parent.pos.z === undefined) {
                $error("Child entity has xyz() pos and parent has xy() pos");
            }
            child.pos.z = child.pos_in_parent.z + parent.pos.z;
        }
        
        if (child.z_in_parent !== undefined) {
            if (parent.z === undefined) {
                $error("Child entity has z but parent.z = nil");
            }
            child.z = parent.z + child.z_in_parent;
        }

        if (child.offset_with_parent) {
            child.offset.x = (c * child.offset_in_parent.x - s * child.offset_in_parent.y) * parent.scale.x + parent.offset.x;
            child.offset.y = (s * child.offset_in_parent.x + c * child.offset_in_parent.y) * parent.scale.y + parent.offset.y;
        }
      
        entity_update_children(child);
    }
}


/*************************************************************************************/
//
// Graphics functions

// Snap points to the pixels that they cover. This follows our rule of
// integer pixel CORNERS and BOTTOM-RIGHT coverage rules at pixel
// centers.
var $pixelSnap = $Math.floor;

function transform_map_layer_to_ws_z(map, layer) {
    if (! map.$type && map.$type === 'map') {
        $error('First argument to transform_map_layer_to_ws_z() must be a map');
    }
    return layer * map.z_scale + map.z_offset;
}


function transform_ws_z_to_map_layer(map, z) {
    if (! map.$type && map.$type === 'map') {
        $error('First argument to transform_draw_z_to_map_layer() must be a map');
    }
    return (z - map.z_offset) / map.z_scale;
}


function transform_map_space_to_ws(map, map_coord) {
    return xy(map_coord.x * map.sprite_size.x + map.offset.x,
              map_coord.y * map.sprite_size.y + map.offset.y);
}


function transform_ws_to_map_space(map, ws_coord) {
    return xy((ws_coord.x - map.offset.x) / map.sprite_size.x,
              (ws_coord.y - map.offset.y) / map.sprite_size.y);
}


function transform_to(pos, angle, scale, coord) {
    const a = angle * -rotation_sign();
    const C = $Math.cos(a);
    const S = $Math.sin(a);
    
    const Xx =  C, Xy = S;
    const Yx = -S, Yy = C;

    const x = coord.x - pos.x, y = coord.y - pos.y;
    return xy((x * Xx + y * Yx) / scale.x,
              (x * Xy + y * Yy) / scale.y);
}


function transform_from(pos, angle, scale, coord) {
    const a = angle * -rotation_sign();
    const C = $Math.cos(a);
    const S = $Math.sin(a);

    const Xx =  C, Xy = S;
    const Yx = -S, Yy = C;

    const x = coord.x * scale.x, y = coord.y * scale.y;
    return {x: x * Xx + y * Xy + pos.x, y: x * Yx + y * Yy + pos.y};
}


function map_resize(map, w, h, layers) {
    if (layers === undefined) { layers = map.layer.length; }
    if (w === undefined) { w = map.size.x; }
    if (h === undefined) { h = map.size.y; }

    // The code below uses map.size as the current size of the map and
    // w, h as the final destination size so that the individual
    // horizontal, vertical, and layer blocks could be reordered.

    // Vertical
    if (h !== map.size.y) {
        // Shrink or grow
        for (let L = 0; L < map.layer.length; ++L) {
            for (let x = 0; x < map.size.x; ++x) {
                map.layer[L][x].length = h;
            }
        }
        map.size = Object.freeze({x: map.size.x, y: h});
    }

    // Horizontal
    if (w < map.size.x) {
        // Shrink
        for (let L = 0; L < map.layer.length; ++L) {
            map.layer[L].length = w;
        }
        map.size = Object.freeze({x: w, y: map.size.y});
    } else if (w > map.size.x) {
        // Grow
        map.size = Object.freeze({x: w, y: map.size.y});
        for (let L = 0; L < map.layer.length; ++L) {
            for (let x = map.layer[L].length; x < w; ++x) {
                map.layer[L].push(new Array(map.size.y));
            }
        }
    }

    // Note that map == map.layer[0]
    if (layers < map.layer.length) {
        // Shrink
        map.layer.length = layers;
    } else if (layers > map.layer.length) {
        // Grow
        for (let L = map.layer.length; L < layers; ++L) {
            map.layer.push(new Array(map.size.x));
            for (let x = 0; x < map.size.x; ++x) {
                map.layer[L][x] = new Array(map.size.y);
            }
        }
    }

    $console.assert(map.layer[0] === map);
    $console.assert(map.layer.length === layers, "Inconsistent number of layers");
    $console.assert(map.layer[map.layer.length - 1].length === map.size.x, "Inconsistent size in X");
    $console.assert(map.layer[map.layer.length - 1][0].length === map.size.y, "Inconsistent size in Y");

    map.size_pixels = Object.freeze({x:map.size.x * map.sprite_size.x, y:map.size.y * map.sprite_size.y});
}


function map_generate_maze(args) {
    const map = args.map;
    if (!map || map.$type !== 'map') {
        $error('map_generate_maze() requires a map property on the argument');
    }

    const hallThickness = $Math.ceil({thickness: 1, ...(args.hall || {})}.thickness);
    const wallThickness = $Math.ceil({thickness: 1, ...(args.wall || {})}.thickness);
    const horizontal    = {border: 1, symmetric: false, loop: false, ...(args.horizontal || {})};
    const vertical      = {border: 1, symmetric: false, loop: false, ...(args.vertical   || {})};  
    
    const s = 2 / (hallThickness + wallThickness);
    const maze = $make_maze(
        $Math.ceil((map.size.x - horizontal.border * wallThickness + (horizontal.loop ? 0 : 1 + wallThickness)) * s),
        $Math.ceil((map.size.y -   vertical.border * wallThickness + (vertical.loop ? 0 : 1 + wallThickness)) * s),
        horizontal,
        vertical,
        args.straightness || 0,
        args.shortcuts || 0,
        (args.coverage === undefined) ? 1 : args.coverage,
        args.dead_end_array || [],
        hallThickness,
        wallThickness,
        args.random || random);

    // Resize the map
    const layer = args.layer || 0;
    map_resize(map, maze.length, maze[0].length);

    const hall_sprite = args.hall ? args.hall.sprite : undefined;
    const wall_sprite = args.wall ? args.wall.sprite : map.spritesheet[0][0];

    if (hall_sprite === undefined && wall_sprite === undefined) {
        $error('Either hall.sprite or wall.sprite must be defined for map_generate_maze()');
    }
    
    // Copy over the elements
    //let str = '';
    for (let y = 0; y < map.size.y; ++y) {
        for (let x = 0; x < map.size.x; ++x) {
            map.layer[layer][x][y] = maze[x][y] ? wall_sprite : hall_sprite;
            //str += maze[x][y] ? '*' : ' ';
        }
        //str += '\n';
    }
    //$console.log(str);
}


function $make_maze(w, h, horizontal, vertical, straightness, imperfect, fill, deadEndArray, hallWidth, wallWidth, random) {
    const hSymmetry = horizontal.symmetric !== false;
    const hBorder   = horizontal.border === undefined ? 1 : horizontal.border;
    // Ignore wrapping unless the border and symmetry are also set; in
    // that case, generate without wrapping and poke holes in the
    // border
    const hWrap     = (horizontal.loop !== false) && !(hSymmetry && hBorder);
    
    const vSymmetry = vertical.symmetric !== false;
    const vBorder   = vertical.border === undefined ? 1 : vertical.border;
    const vWrap     = (vertical.loop !== false) && !(vSymmetry && vBorder);
    
    const SOLID = 255, RESERVED = 127, EMPTY = 0;
    const floor = $Math.floor;
          
    function randomInt(x) { return floor(random() * x); }

    // Knuth-Fisher-Yates shuffle of an Array
    function shuffle(a) { for (let i = a.length - 1; i > 0; --i) { let j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } }

    // Argument cleanup
    if (deadEndArray === undefined) { deadEndArray = []; }

    // Account for edges that will later be stripped
    if (! hBorder) {
        ++w;
        if (! hWrap) { ++w; }
    }
    
    if (! vBorder) {
        ++h;
        if (! vWrap) { ++h; }
    }
    
    imperfect = $Math.min(1, $Math.max(0, imperfect || 0));
    if (fill === undefined) { fill = 1; }
    let reserveProb = (1 - $Math.min($Math.max(0, fill * 0.9 + 0.1), 1))**1.6;

    if (hWrap) {
        if (hSymmetry) {
            // Must be a multiple of 4 offset by 2
            // for mirror symmetry
            w = $Math.round((w - 2) / 4) * 4 + 2;
        } else {
            // Ensure even size
            w += w & 1; 
        }
    } else {
        // Ensure odd size
        w += ~(w & 1);
    }

    if (vWrap) {
        if (vSymmetry) {
            h = $Math.round((h - 2) / 4) * 4 + 2;
        } else {
            h += h & 1;
        }

    } else {
        h += ~(h & 1);
    }

    // Allocate and initialize to solid
    let maze = new Array(w);
    for (let x = 0; x < w; ++x) {
        maze[x] = new Array(h).fill(SOLID);
    }

    // Reserve some regions
    if (reserveProb > 0) {
        for (let x = 1; x < w; x += 2) {
            for (let y = 1, m = maze[x]; y < h; y += 2) {
                if (random() < reserveProb) { m[y] = RESERVED; }
            } // y
        } // x
    }

    // Carve hallways recursively, starting at the center
    let stack = [{x: floor(w / 4) * 2 - 1, y: floor(h / 4) * 2 - 1, step: {x: 0, y: 0}}];
    deadEndArray.push(stack[0]);
    let directions = [{x:-1, y:0}, {x:1, y:0}, {x:0, y:1}, {x:0, y:-1}];

    // Don't start reserving until a path of at least this length has been carved
    let ignoreReserved = $Math.max(w, h);

    function unexplored(x, y) {
        let c = maze[x][y];
        return (c === SOLID) || ((c === RESERVED) && (ignoreReserved > 0));
    }

    const hBorderOffset = hWrap ? 0 : 1;
    const vBorderOffset = vWrap ? 0 : 1;

    function set(x, y, value) {
        x = (x + w) % w;
        y = (y + h) % h;

        maze[x][y] = value;
        
        const u = w - x - hBorderOffset;
        const v = h - y - vBorderOffset
        if (hSymmetry) {
            if (u < w) {
                maze[u][y] = value;
                if (vSymmetry) {
                    maze[u][v] = value;
                }
            }
        }
        
        if (vSymmetry && v < h) {
            maze[x][v] = value;
        }                
    }
    
    while (stack.length) {
        const cur = stack.pop();

        // Unvisited?
        if (unexplored(cur.x, cur.y)) {

            // Mark visited
            set(cur.x, cur.y, EMPTY);

            // Carve the wall back towards the source
            set(cur.x - cur.step.x, cur.y - cur.step.y, EMPTY);
            
            --ignoreReserved;

            // Fisher-Yates shuffle directions
            shuffle(directions);

            // Prioritize a straight line. Note that cur.step is a
            // pointer to one of the directions, so we can use pointer
            // equality to find it.
            if (random() < straightness) {
                for (let i = 0; i < 4; ++i) {
                    if (directions[i] === cur.step) {
                        // Swap with the last
                        directions[i] = directions[3];
                        directions[3] = cur.step;
                        break;
                    }
                }
            }
            
            // Push neighbors if not visited
            let deadEnd = true;
            for (let i = 0; i < 4; ++i) {
                const step = directions[i];
                let x = cur.x + step.x * 2;
                let y = cur.y + step.y * 2;
                
                if (hWrap) { x = (x + w) % w; }
                if (vWrap) { y = (y + h) % h; }
                
                if ((x >= 0) && (y >= 0) && (x < w) && (y < h) && unexplored(x, y)) {
                    // In bounds and not visited
                    stack.push({x:x, y:y, step:step});
                    deadEnd = false;
                }
            } // for each direction
            
            if (deadEnd) { deadEndArray.push(cur); }
        } // if unvisited
    } // while unvisited

    
    if (imperfect > 0) {
        // Boundary
        const hBdry = hWrap ? 0 : 1;
        const vBdry = vWrap ? 0 : 1;

        // Removes the wall at (x, y) if at least one neighbor is also
        // empty
        function remove(x, y) {
            let a = maze[x][(y + 1) % h], b = maze[x][(y - 1 + h) % h],
                c = maze[(x + 1) % w][y], d = maze[(x - 1 + w) % w][y];
            if ($Math.min(a, b, c, d) === EMPTY) {
                set(x, y, EMPTY);
            }
        }
        
        // Remove some random walls, preserving the edges if not wrapping.
        for (let i = $Math.ceil(imperfect * w * h / 3); i > 0; --i) {
            remove(randomInt(w * 0.5 - hBdry * 2) * 2 + 1,         randomInt(h * 0.5 - vBdry * 2) * 2 + vBdry * 2);
            remove(randomInt(w * 0.5 - hBdry * 2) * 2 + hBdry * 2, randomInt(h * 0.5 - vBdry * 2) * 2 + 1);
        }
        
        // Reconnect single-wall islands
        for (let y = 0; y < h; y += 2) {
            for (let x = 0; x < w; x += 2) {
                let a = maze[x][(y + 1) % h], b = maze[x][(y - 1 + h) % h],
                    c = maze[(x + 1) % w][y], d = maze[(x - 1 + w) % w][y];
                
                if (a === EMPTY && b === EMPTY && c === EMPTY && d === EMPTY) {
                    // This is an island. Restore one adjacent wall at random
                    let dir = directions[randomInt(4)];
                    set(x + dir.x, y + dir.y, SOLID);
                }
            } // x
        } // y
    }

    // Unreserve everything
    if (reserveProb > 0) {
        for (let x = 1; x < w; x += 2) {
            for (let y = 1, m = maze[x]; y < h; y += 2) {
                if (m[y] === RESERVED) { m[y] = SOLID; }
            } // y
        } // x
    } // reserveProb

    if (horizontal.loop && (horizontal.border === undefined ? 1 : horizontal.border) && horizontal.symmetric) {
        // Poke some holes in the border. The regular generator
        // doesn't handle this case elegantly
        // Decrease probability with straightness, increase with
        // imperfection
        const prob = 0.025 + 0.25 * (1 - straightness**2 * (1 - imperfect)) + 0.5 * imperfect;
        for (let y = 1; y < maze[0].length; y += 2) {

            // Do not create a passage into a wall or immediately below another
            if ((maze[1][y] === EMPTY) &&
                (maze[0][y - 2] !== EMPTY) && 
                (random() < prob)) {
                maze[0][y] = EMPTY;
                maze[maze.length - 1][y] = EMPTY;
            }
        }
    }

    if (vertical.loop && (vertical.border === undefined ? 1 : vertical.border) && vertical.symmetric) {
        const prob = 0.05 + 0.15 * (1 - straightness * (1 - imperfect)) + 0.5 * imperfect;
        for (let x = 1; x < maze.length; x += 2) {

            // Do not create a passage into a wall or immediately beside another
            if ((maze[x][1] === EMPTY) &&
                (x < 2 || maze[x - 2][0] !== EMPTY) && 
                (random() < prob)) {
                maze[x][0] = EMPTY;
                maze[x][maze[0].length - 1] = EMPTY;
            }
        }
    }
    
    // Horizontal borders
    if (! hWrap && ! hBorder) {
        // Remove border
        maze.shift();
        maze.pop();
        
        // Correct the dead ends for the new coordinates
        for (let i = 0; i < deadEndArray.length; ++i) {
            --deadEndArray[i].x;
        }
    } else if (hBorder && hWrap && ! hSymmetry) {
        // Duplicate the left edge on the right
        maze.push([...maze[0]]);

        // Duplicate dead ends
        for (let i = 0; i < deadEndArray.length; ++i) {
            if (deadEndArray[i].x === 0) {
                deadEndArray.push({x: maze.length - 1, y: deadEndArray[i].y})
            }
        }
    } else if (hSymmetry && hWrap) {
        // Remove the left wall and hall columns; the wall will
        // be a solid edge and the hall is the same as
        // the rightmost one
        maze.shift();
        maze.shift();

        // Correct the dead ends for the new coordinates
        for (let i = 0; i < deadEndArray.length; ++i) {
            deadEndArray[i].x -= 2;
        }
    }


    // Vertical borders
    if (vBorder && vWrap && ! vSymmetry) {
        // Duplicate the top edge on the bottom
        for (let x = 0; x < maze.length; ++x) {
            maze[x].push(maze[x][0]);
        }
        
        //  Duplicate dead ends
        for (let i = 0; i < deadEndArray.length; ++i) {
            if (deadEndArray[i].y === 0) {
                deadEndArray.push({x: deadEndArray[i].x, y: maze[0].length - 1})
            }
        }
    } else if (! vWrap && ! vBorder) {
        // Remove border
        for (let x = 0; x < maze.length; ++x) {
            maze[x].shift();
            maze[x].pop();
        }
        
        // Correct the dead ends for the new coordinates
        for (let i = 0; i < deadEndArray.length; ++i) {
            --deadEndArray[i].y;
        }
    } else if (vSymmetry && vWrap) {
        // Remove the top wall and top columns; the wall will
        // be a solid edge and the hall is the same as
        // the bottom one
        for (let x = 0; x < maze.length; ++x) {
            maze[x].shift();
            maze[x].shift();
        }

        // Correct the dead ends for the new coordinates
        for (let i = 0; i < deadEndArray.length; ++i) {
            deadEndArray[i].y -= 2;
        }
    }

    // Remove out of bounds dead ends after the border has been adjusted
    for (let i = 0; i < deadEndArray.length; ++i) {
        if (deadEndArray[i].x < 0 || deadEndArray[i].y < 0) {
            deadEndArray[i] = deadEndArray[deadEndArray.length - 1];
            deadEndArray.pop();
            --i;
        }
    }

    // Expand hall and wall width
    if ((hallWidth > 1) || (wallWidth > 1)) {
        const width = maze.length, height = maze[0].length;
        const old = maze;
        maze = [];
        
        // Stripping the border alters the phase of the edges
        const xPhase = ! hBorder && ! hWrap ? 1 : 0;
        const yPhase = ! vBorder && ! vWrap ? 1 : 0;
    
        for (let x = 0; x < width; ++x) {
            for (let src = old[x], i = (((x + xPhase) & 1) ? hallWidth : wallWidth); i > 0; --i) {
                let dst = [];
                for (let y = 0; y < height; ++y) {
                    for (let c = src[y], j = (((y + yPhase) & 1) ? hallWidth : wallWidth); j > 0; --j) {
                        dst.push(c);
                    } // j
                } // y
                maze.push(dst);
            } // i
        } // x
        
        // Adjust deadEndArray
        for (let i = 0; i < deadEndArray.length; ++i) {
            const c = deadEndArray[i];
            c.x = (c.x >> 1) * (wallWidth + hallWidth) + (1 - xPhase) * wallWidth + hallWidth / 2;
            c.y = (c.y >> 1) * (wallWidth + hallWidth) + (1 - yPhase) * wallWidth + hallWidth / 2;
        }
    }

    // May be negative! 
    const hPad = $Math.round((hBorder - 1) * wallWidth);
    
    // Increase the border thickness by duplication
    for (let i = 0; i < hPad; ++i) {
        maze.unshift([...maze[0]]);
        maze.push([...maze[maze.length - 1]]);
    }

    // Decrease border thickness by trimming
    for (let i = 0; i < -hPad; ++i) {
        maze.shift();
        maze.pop();
    }

    const vPad = $Math.round((vBorder - 1) * wallWidth);
    for (let i = 0; i < vPad; ++i) {
        for (let x = 0; x < maze.length; ++x) {
            maze[x].unshift(maze[x][0]);
            maze[x].push(maze[x][maze[x].length - 1]);
        }
    }

    for (let i = 0; i < -vPad; ++i) {
        for (let x = 0; x < maze.length; ++x) {
            maze[x].shift();
            maze[x].pop();
        }
    }

    // Adjust deadEndArray
    if (hPad !== 0 || vPad !== 0) {
        for (let i = 0; i < deadEndArray.length; ++i) {
            deadEndArray[i].x += hPad;
            deadEndArray[i].y += vPad;
        }
    }

    return maze;
}


function sprite_transfer_orientation(orient_sprite, content_sprite) {
    if (! orient_sprite || ! orient_sprite.$type === 'sprite') {
        $error('The first argument to sprite_transfer_orientation() must be a sprite');
    }

    if (! content_sprite || ! (content_sprite.$type === 'sprite' || content_sprite.$type === 'spritesheet')) {
        $error('The second argument to sprite_transfer_orientation() must be a sprite or spritesheet');
    }

    if (content_sprite.$type === 'spritesheet') {
        content_sprite = content_sprite[orient_sprite.tile_index.x][orient_sprite.tile_index.y];
    }
    
    const base = orient_sprite.base;

    if (base.$spritesheet !== orient_sprite.$spritesheet) {
        // Transposed
        content_sprite = content_sprite.rotated_270.x_flipped;
    }

    if (orient_sprite.scale.x < 0) {
        content_sprite = content_sprite.x_flipped;
    }

    if (orient_sprite.scale.y < 0) {
        content_sprite = content_sprite.y_flipped;
    }
    
    return content_sprite;
}



function get_map_pixel_color(map, map_coord, min_layer, max_layer_exclusive, replacement_array, result, invert_sprite_y) {
    if (min_layer === undefined) {
        min_layer = 0;
    }

    if (max_layer_exclusive === undefined) {
        max_layer_exclusive = map.layer.length >>> 0;
    }

    min_layer = $Math.ceil(min_layer) >>> 0;
    max_layer_exclusive = max_layer_exclusive >>> 0;

    if ((max_layer_exclusive <= 0) || (min_layer >= map.layer.length)) {
        // Nothing to do
        if (result) {
            result.a = 0;
            return result;
        } else {
            return undefined;
        }
    }

    if (invert_sprite_y === undefined) {
        invert_sprite_y = false;
    }

    // The caller needs to be able to distinguish between
    // out of bounds/no sprite and a sprite with alpha = 0,
    // so we have to have an explicit undefined option for
    // the return value.
    const had_result = result;
    if (result === undefined) {
        result = {r:0, g:0, b:0, a:0};
    }
    
    const pixel = $get_map_pixel_color(map, map_coord.x, map_coord.y, min_layer, max_layer_exclusive, replacement_array, result, invert_sprite_y);
    if (pixel === -1) {
        if (had_result) {
            return result;
        } else {
            return undefined;
        }
    }

    if (pixel === -2) {
        return result;
    } else {
        // Unpack
        result.a = ((pixel >>> 12) & 0xf) * (1 / 15);
        result.b = ((pixel >>> 8) & 0xf) * (1 / 15);
        result.g = ((pixel >>> 4) & 0xf) * (1 / 15);
        result.r = (pixel & 0xf) * (1 / 15);
        return result;
    }
}


function $ws_coord_to_map_sprite_coord(map, ws_coord, layer, sprite_coord) {
    // = transform_ws_to_map_space(map, ws_coord);
    const map_coord_x = (ws_coord.x - map.offset.x) / map.sprite_size.x,
          map_coord_y = (ws_coord.y - map.offset.y) / map.sprite_size.y;

    const map_size_x = map.size.x, map_size_y = map.size.y;
    
    if (map.loop_x && (map_coord_x < 0 || map_coord_x >= map_size_x)) {
        map_coord_x -= $Math.floor(map_coord_x / map_size_x) * map_size_x;
    }
    
    if (map.loop_y && (map_coord_y < 0 || map_coord_y >= map_size_y)) {
        map_coord_y -= $Math.floor(map_coord_y / map_size_y) * map_size_y;
    }

    // Integer version of the map coordinate
    const mx = $Math.floor(map_coord_x) | 0, my = $Math.floor(map_coord_y) | 0;

    // Map coord (0, 0) is the *corner* of the corner sprite
    const ssX = (map.sprite_size.x >>> 0) - 1, ssY = (map.sprite_size.y >>> 0) - 1;

    sprite_coord.x = $clamp(((map_coord_x - mx) * (ssX + 1)) | 0, 0, ssX);
    sprite_coord.y = $clamp(((map_coord_y - my) * (ssY + 1)) | 0, 0, ssY);
}


// Return value:
//  -1:        out of bounds or no sprite
//  -2:        value in result
//  otherwise: value is a uint16 in the return value
function $get_map_pixel_color(map, map_coord_x, map_coord_y, min_layer, max_layer_exclusive, replacement_array, result, invert_sprite_y) {
    const map_size_x = map.size.x, map_size_y = map.size.y;
    // Inlined $loop()
    if (map.loop_x && (map_coord_x < 0 || map_coord_x >= map_size_x)) {
        map_coord_x -= $Math.floor(map_coord_x / map_size_x) * map_size_x;
    }
    if (map.loop_y && (map_coord_y < 0 || map_coord_y >= map_size_y)) {
        map_coord_y -= $Math.floor(map_coord_y / map_size_y) * map_size_y;
    }

    // Integer version of the map coordinate
    const mx = $Math.floor(map_coord_x) | 0, my = $Math.floor(map_coord_y) | 0;
    
    // Was any surface hit?
    let hit = false;

    // Result value temporarily encoded in scalars to avoid dereference costs
    let result_a = 0, result_b = 0, result_g = 0, result_r = 0;

    // In bounds test
    if ((mx >= 0) && (my >= 0) && (mx < map_size_x) && (my < map_size_y)) {

        // Map coord (0, 0) is the *corner* of the corner sprite
        const ssX = (map.sprite_size.x >>> 0) - 1, ssY = (map.sprite_size.y >>> 0) - 1;
        let spriteCoordX = $clamp(((map_coord_x - mx) * (ssX + 1)) | 0, 0, ssX);
        let spriteCoordY = $clamp(((map_coord_y - my) * (ssY + 1)) | 0, 0, ssY);

        // Account for the automatic flipping that occurs to sprites when rendering
        if (($scaleY < 0) !== invert_sprite_y) { spriteCoordY = (ssY - spriteCoordY) | 0; }
        if ($scaleX < 0) { spriteCoordX = (ssX - spriteCoordX) | 0; }

        // Iterate from the top down, compositing
        const layer_array = map.layer;
        for (let layer = max_layer_exclusive - 1; layer >= min_layer; --layer) {
            let sprite = layer_array[layer][mx][my];
            if (sprite) {
                if (replacement_array) {
                    for (let i = 0; i < replacement_array.length; i += 2) {
                        if (replacement_array[i] === sprite) {
                            sprite = replacement_array[i + 1];
                            break;
                        }
                    }
                    if (! sprite) { continue; }
                }

                // Manually inlined and streamlined code from
                // sprite_pixel_color, which saves about 2 ms when
                // sampling every pixel on screen. Coordinate
                // computation needs to be done per-sprite because
                // they may be flipped. It is slightly faster (probably because of
                // cache coherence) to flip the X coordinate than to read from
                // the flipped X image data
                const x = ((sprite.scale.x > 0) ? spriteCoordX : (ssX - spriteCoordX)) >>> 0;
                const y = ((sprite.scale.y > 0) ? spriteCoordY : (ssY - spriteCoordY)) >>> 0;

                const data = sprite.$spritesheet.$uint16Data;
                const pixel = data[((sprite.$x >>> 0) + x) + ((sprite.$y >>> 0) + y) * (data.width >>> 0)] >>> 0;

                const alpha16 = pixel & 0xF000;
                if ((result_a === 0) && (alpha16 === 0xF000)) {
                    // Common case: we've hit a fully opaque value on
                    // the first non-transparent one. Do not convert
                    // to rgba() because this may be called from the
                    // inner loop of draw_map_horizontal_span(). The
                    // caller will handle the case where they need to
                    // convert.
                    return pixel;
                } else if (alpha16 !== 0) {

                    // Unpack and switch to premultiplied
                    const layer_color_a = ((pixel >>> 12) & 0xf) * (1 / 15);
                    const k = (1 / 15) * layer_color_a;
                    const layer_color_b = ((pixel >>> 8) & 0xf) * k;
                    const layer_color_g = ((pixel >>> 4) & 0xf) * k;
                    const layer_color_r = (pixel & 0xf) * k;

                    // Composite layer_color *under* the current result,
                    // since we're working top down
                    if (result_a === 0) {
                        // First non-transparent value, just override
                        result_r = layer_color_r;
                        result_g = layer_color_g;
                        result_b = layer_color_b;
                        result_a = layer_color_a;
                    } else {
                        // Composite in premultiplied color space
                        const k = 1 - result_a;
                        result_r += layer_color_r * k;
                        result_g += layer_color_g * k;
                        result_b += layer_color_b * k;
                        result_a += layer_color_a * k;
                    }

                    // Fully saturated after compositing
                    if (result_a >= 0.995) {
                        // No need to convert *back* from premultiplied because a ~= 1
                        result.r = result_r;
                        result.g = result_g;
                        result.b = result_b;
                        result.a = result_a;
                        return -2;
                    }
                    hit = true;
                    
                } // sprite
            } // layer
        }
    }

    // Composited or never hit any sprite
    
    if (hit) {
        // Convert back from premultiplied, if needed
        result.a = result_a;
        if (result_a > 0 && result_a < 0.995) {
            const inv_a = 1 / result_a;
            result.r = result_r * inv_a;
            result.g = result_g * inv_a;
            result.b = result_b * inv_a;
        } else {
            // No need to convert
            result.r = result_r;
            result.g = result_g;
            result.b = result_b;
        }
        // Composited
        return -2;
    } else {
        // Out of bounds or no sprite
        result.r = result.g = result.b = result.a = 0;
        return -1;
    }
}


function get_map_pixel_color_by_ws_coord(map, ws_coord, ws_z, replacement_array, result) {
    if (replacement_array && ! Array.isArray(replacement_array)) { $error('The replacement array for get_map_pixel_color_by_ws_coord() must be nil or an array'); }
    if (! map.spritesheet_table) { $error('The first argument to get_map_pixel_color_by_ws_coord() must be a map'); }
    const layer = (((ws_z || 0) - $offsetZ) / $scaleZ - map.z_offset) / map.z_scale;
    return get_map_pixel_color(map, transform_ws_to_map_space(map, ws_coord), layer, replacement_array, result);
}


function get_map_sprite(map, map_coord, layer, replacement_array) {
    if (! map.spritesheet_table) { $error('The first argument to get_map_sprite() must be a map'); }
    layer = $Math.floor(layer || 0) | 0;
    let mx = $Math.floor(map_coord.x);
    let my = $Math.floor(map_coord.y);

    if (map.loop_x) { mx = $loop(mx, 0, map.size.x); }
    if (map.loop_y) { my = $loop(my, 0, map.size.y); }
    
    if ((layer >= 0) && (layer < map.layer.length) &&
        (mx >= 0) && (my >= 0) &&
        (mx < map.size.x) && (my < map.size.y)) {
        // In bounds
        let sprite = map.layer[layer][mx][my];
        if (replacement_array) {
            for (let i = 0; i < replacement_array.length; i += 2) {
                if (replacement_array[i] === sprite) {
                    return replacement_array[i + 1];
                    break;
                }
            }
        }

        return sprite;

    } else {
        return undefined;
    }
}


function set_map_sprite(map, map_coord, sprite, layer) {
    layer = $Math.floor(layer || 0) | 0;
    let mx = $Math.floor(map_coord.x);
    let my = $Math.floor(map_coord.y);

    if (map.loop_x) { mx = loop(mx, map.size.x); }
    if (map.loop_y) { my = loop(my, map.size.y); }

    if ((layer >= 0) && (layer < map.layer.length) &&
        (mx >= 0) && (my >= 0) &&
        (mx < map.size.x) && (my < map.size.y)) {
        // In bounds
        map.layer[layer][mx][my] = sprite;
    }
}


function get_map_sprite_by_ws_coord(map, ws_coord, ws_z, replacement_array) {
    const layer = ((ws_z || 0) - $offsetZ - map.z_offset) / ($scaleZ * map.z_scale);
    return get_map_sprite(map, transform_ws_to_map_space(map, ws_coord), layer, replacement_array);
}


function set_map_sprite_by_ws_coord(map, ws_coord, sprite, z) {
    const layer = ((z || 0) - $offsetZ) / ($scaleZ * map.z_scale);
    return set_map_sprite(map, transform_ws_to_map_space(map, ws_coord), sprite, layer);
}


function draw_map(map, min_layer, max_layer, replacements, pos, angle, scale, z_shift, override_color, override_blend) {
    if ($skipGraphics) { return; }
    
    if (! map.layer && map.map && (arguments.length === 1)) {
        // named argument version
        min_layer = map.min_layer;
        max_layer = map.max_layer;
        replacements = map.replacement_array;
        pos = map.pos;
        angle = map.angle;
        scale = map.scale;
        override_color = map.override_color;
        override_blend = map.override_blend;
        z_shift = map.z;
        map = map.map; 
    }

    const multiply = override_blend === 'multiply';
    if (override_color) {
        // have to clone and convert to RGB space
        override_color = rgba(override_color);
    }

    if (min_layer === undefined) { min_layer = 0; }

    if (max_layer === undefined) { max_layer = map.layer.length - 1; }

    if ((typeof $camera.zoom === 'function') && (min_layer !== max_layer)) {
        // Must draw layers separately when there is a zoom function.
        // Draw in order from back to front to preserve z-order.
        for (let L = min_layer; L <= max_layer; ++L) {
            draw_map(map, L, L, replacements, pos, angle, scale, z_shift, override_color, override_blend);
        }
        return;
    }
    
    if (typeof scale === 'number') { scale = xy(scale, scale); }

    if (pos === undefined) { pos = xy(0, 0); }

    if (angle === undefined) { angle = 0; }

    if (scale === undefined) { scale = xy(1, 1); }

    if (z_shift === undefined) {
        z_shift = pos.z;
    }
    z_shift = z_shift || 0;
    let z_pos = (pos.z === undefined) ? z_shift : pos.z;
    let z_order = z_shift;

    override_color = override_color ? $colorToUint16(override_color) : 0;

    if (($camera.x !== 0) || ($camera.y !== 0) || ($camera.angle !== 0) || ($camera.zoom !== 1)) {
        // Use the z-value from the lowest layer for perspective. If the zoom is a
        // function, then draw_map() guarantees that there is only one
        // layer at a time!
        const z = (min_layer * map.z_scale + map.z_offset + z_pos) - $camera.z;

        // Transform the arguments to account for the camera
        const mag = $zoom(z);
        const C = $Math.cos($camera.angle) * mag, S = $Math.sin($camera.angle * rotation_sign()) * mag;
        const x = pos.x - $camera.x, y = pos.y - $camera.y;
        pos = {x: x * C + y * S, y: y * C - x * S};
        angle -= $camera.angle;
        scale = {x: scale.x * mag, y: scale.y * mag};
    }

    if (replacements !== undefined) {
        if (! Array.isArray(replacements)) { $error('The replacements for draw_map() must be an array'); }
        if (replacements.length & 1 !== 0) { $error('There must be an even number of elements in the replacements array'); }
        // Convert to a map for efficiency (we need to copy anyway)
        const array = replacements;
        replacements = new Map();
        const N = array.length;
        for (let i = 0; i < N; i += 2) {
            replacements.set(array[i], array[i + 1]);
        }
    }

    // Compute the map axes in draw space
    const drawU = xy($Math.cos(angle), $Math.sin(angle * rotation_sign()));
    const drawV = perp(drawU);
    drawU.x *= scale.x; drawU.y *= scale.x;
    drawV.x *= scale.y; drawV.y *= scale.y;

    const spriteSizeX = map.sprite_size.x;
    const spriteSizeY = map.sprite_size.y;
    
    // Handle map wrapping with a 3x3 grid
    const oldDrawOffsetX = $offsetX, oldDrawOffsetY = $offsetY;
    for (let shiftY = -1; shiftY <= +1; ++shiftY) {
        if (! map.loop_y && shiftY !== 0) { continue; }
        
        for (let shiftX = -1; shiftX <= +1; ++shiftX) {
            if (! map.loop_x && shiftX !== 0) { continue; }

            // Shift amount for this instance of the tiled map
            const mapSpaceOffset = xy(map.size.x * map.sprite_size.x * shiftX,
                                      map.size.y * map.sprite_size.y * shiftY);
            $offsetX = oldDrawOffsetX + $scaleX * (drawU.x * mapSpaceOffset.x + drawV.x * mapSpaceOffset.y);
            $offsetY = oldDrawOffsetY + $scaleY * (drawU.y * mapSpaceOffset.x + drawV.y * mapSpaceOffset.y);
            
            // Take the screen-space clip coordinates to draw coords.
            // This does nothing if there is no offset or scale
            const drawClip1 = xy(($clipX1 - $offsetX) / $scaleX, ($clipY1 - $offsetY) / $scaleY);
            const drawClip2 = xy(($clipX2 - $offsetX) / $scaleX, ($clipY2 - $offsetY) / $scaleY);

            // Take the draw-space clip coordinates to the min/max map
            // coords.  When rotated, this may cause significant
            // overdraw, as snapping to an axis-aligned bounding box
            // in the rotated map space could be fitting a diamond
            // with a square. 
            let mapX1, mapX2, mapY1, mapY2;
            {
                //$console.log(transform_to(pos, angle, scale, drawClip2));
                // Apply pos, angle, scale.
                // We have to consider all four corners for the rotation case.
                const temp1 = transform_ws_to_map_space(map, transform_to(pos, angle, scale, drawClip1)),
                      temp2 = transform_ws_to_map_space(map, transform_to(pos, angle, scale, drawClip2)),
                      temp3 = transform_ws_to_map_space(map, transform_to(pos, angle, scale, xy(drawClip1.x, drawClip2.y))),
                      temp4 = transform_ws_to_map_space(map, transform_to(pos, angle, scale, xy(drawClip2.x, drawClip1.y)));
                
                mapX1 = $Math.floor($Math.min(temp1.x, temp2.x, temp3.x, temp4.x));
                mapX2 = $Math.ceil ($Math.max(temp1.x, temp2.x, temp3.x, temp4.x));
                
                mapY1 = $Math.floor($Math.min(temp1.y, temp2.y, temp3.y, temp4.y));
                mapY2 = $Math.ceil ($Math.max(temp1.y, temp2.y, temp3.y, temp4.y));

                mapX1 = $Math.max(mapX1, 0);
                mapX2 = $Math.min(mapX2, map.size.x - 1);
                
                mapY1 = $Math.max(mapY1, 0);
                mapY2 = $Math.min(mapY2, map.size.y - 1);
            }

            // Setup draw calls for the layers. We process each cell
            // "vertically" within all layers from top to bottom in
            // the following code so that lower layers can be culled
            // when occluded.
            
            const numLayers = max_layer - min_layer + 1;
            const layerSpriteArrays = [];
            const layerZOrder = [];
            layerSpriteArrays.length = numLayers;
            layerZOrder.length = numLayers;
            for (let L = min_layer; L <= max_layer; ++L) {
                const layer = map.layer[L];
                const i = L - min_layer;
                
                layerZOrder[i] = (L * map.z_scale + map.z_offset + z_order - $camera.z) * $scaleZ + $offsetZ;
                
                const layer_z_pos = (L * map.z_scale + map.z_offset + z_pos - $camera.z) * $scaleZ + $offsetZ;
                if (layer_z_pos >= $clipZ1 && layer_z_pos <= $clipZ2) {
                    layerSpriteArrays[i] = [];
                } 
            }

            // Compute the sprite calls. We pack them together into big
            // layer calls to reduce sorting, but since the map is
            // mutable we have to actually copy all elements for those
            // calls.

            const radius = $Math.hypot(map.sprite_size.x, map.sprite_size.y) * 0.5 *
                  $Math.max($Math.abs(scale.x), $Math.abs(scale.y));
            
            for (let mapX = mapX1; mapX <= mapX2; ++mapX) {
                for (let mapY = mapY1; mapY <= mapY2; ++mapY) {
                            
                    // Compute the screen coordinates. Sprites are
                    // rendered from centers, so offset each by 1/2
                    // the tile size.
                    const x = (mapX + 0.5) * map.sprite_size.x + map.offset.x;
                    const y = (mapY + 0.5) * map.sprite_size.y + map.offset.y;
                    
                    const screenX = (drawU.x * x + drawV.x * y + pos.x) * $scaleX + $offsetX;
                    const screenY = (drawU.y * x + drawV.y * y + pos.y) * $scaleY + $offsetY;
                    
                    // If there is rotation, this particular sprite
                    // column might be off screen
                    if ((screenX + radius < $clipX1 - 0.5) && (screenY + radius < $clipY1 - 0.5) &&
                        (screenX >= $clipX2 + radius + 0.5) && (screenY >= $clipY2 + radius + 0.5)) {
                        continue;
                    }
                    
                    // Process layers from the top down, so that we can occlusion cull
                    for (let L = max_layer; L >= min_layer; --L) {
                        const i = L - min_layer;
                        
                        // Sprite calls in this layer
                        const data = layerSpriteArrays[i];
                                                
                        if (! data) {
                            // This layer is z-clipped
                            continue;
                        }

                        let sprite = map.layer[L][mapX][mapY];
                    
                        if (sprite === undefined) {
                            // Empty sprite cell
                            continue;
                        }
                            
                        if (replacements && replacements.has(sprite)) {
                            // Perform replacement
                            sprite = replacements.get(sprite);
                            
                            // ...which may be empty
                            if (sprite === undefined) { continue; }
                        }

                        const sprElt = {
                            spritesheetIndex: sprite.$spritesheet.$index[0],
                            cornerX:  sprite.$x,
                            cornerY:  sprite.$y,
                            sizeX:    sprite.size.x,
                            sizeY:    sprite.size.y,
                            angle:    angle,
                            scaleX:   scale.x * sprite.scale.x,
                            scaleY:   scale.y * sprite.scale.y,
                            hasAlpha: sprite.$hasAlpha,
                            opacity:  1,
                            override_color: override_color,
                            multiply: multiply,
                            x:        screenX,
                            y:        screenY
                        };

                        /*
                        // Expensive assertion disabled
                        $console.assert(sprElt.spritesheetIndex >= 0 &&
                                        sprElt.spritesheetIndex < $spritesheetArray.length,
                                        sprite.$name + ' sprite has a bad index: ' + sprElt.spritesheetIndex);
                        */

                        data.push(sprElt);
                        
                        if (! sprite.$hasAlpha) {
                            // No need to process other layers, since this sprite
                            // occludes everything under it.
                            break;
                        } // occlusion cull
                    } // y
                } // x
            } // For each layer L

            // Submit the non-empty draw calls
            for (let i = 0; i < numLayers; ++i) {
                // Sprite calls in this layer
                const data = layerSpriteArrays[i];
                const baseZOrder = layerZOrder[i];
                
                // Push the command, if there were sprites.
                // Note that the z will be offset based on the order
                // of submission even if all baseZ values are the same.
                if (data && data.length > 0) {
                    $addGraphicsCommand({
                        opcode: 'SPR',
                        baseZ:  baseZOrder,
                        z:      baseZOrder,
                        data:   data
                    });
                }
            } // for each layer
        } // loop_x
    } // loop_y

    $offsetX = oldDrawOffsetX;
    $offsetY = oldDrawOffsetY;
}


/*
function draw_color_tri(A, B, C, color_A, color_B, color_C, pos, angle, scale, z) {
    // Skip graphics this frame
    if ($skipGraphics) { return; }
    
    if (A.A) {
        // Object version
        z = A.z;
        angle = A.angle;
        scale = A.scale;
        pos = A.pos;
        color_A = A.color_A;
        color_B = A.color_B;
        color_C = A.color_C;
        C = A.C;
        B = A.B;
        A = A.A;
    }

    color_A = $colorToUint16(color_A);
    color_B = $colorToUint16(color_B);
    color_C = $colorToUint16(color_C);

    // TODO: transform to screen space
    // TODO: clip empty triangles
    // TODO: add graphics command
}
*/


function draw_tri(A, B, C, color, outline, pos, angle, scale, z) {
    // Skip graphics this frame
    if ($skipGraphics) { return; }
    if (A.A) {
        // Object version
        z = A.z;
        angle = A.angle;
        scale = A.scale;
        pos = A.pos;
        outline = A.outline;
        color = A.color;
        C = A.C;
        B = A.B;
        A = A.A;
    }
    draw_poly([A, B, C], color, outline, pos, angle, scale, z);
}


function draw_disk(pos, radius, color, outline, z) {
    if ($skipGraphics) { return; }

    if (pos.pos) {
        // Object version
        outline = pos.outline;
        color = pos.color;
        radius = pos.radius;
        z = pos.z;
        pos = pos.pos;
    }

    if (radius === undefined) {
        $error('draw_disk() requires a non-nil radius')
    }

    let z_order = z;
    if (z_order === undefined) { z_order = pos.z; }
    if (z_order === undefined) { z_order = 0; }
    let z_pos = pos.z;
    if (z_pos === undefined) { z_pos = z_order; }

    z_order -= $camera.z;
    z_pos -= $camera.z;
    
    if (($camera.x !== 0) || ($camera.y !== 0) || ($camera.angle !== 0) || ($camera.zoom !== 1)) {
        // Transform the arguments to account for the camera
        const mag = $zoom(z_pos);
        const C = $Math.cos($camera.angle) * mag, S = $Math.sin($camera.angle * rotation_sign()) * mag;
        const x = pos.x - $camera.x, y = pos.y - $camera.y;
        pos = {x: x * C + y * S, y: y * C - x * S};
        radius *= mag;
    }
    
    const skx = (z_pos * $skewXZ), sky = (z_pos * $skewYZ);
    let x = (pos.x + skx) * $scaleX + $offsetX, y = (pos.y + sky) * $scaleY + $offsetY;
    z_pos = z_pos * $scaleZ + $offsetZ;
    z_order = z_order * $scaleZ + $offsetZ;

    // Culling optimization
    if ((x - radius > $clipX2 + 0.5) || (y - radius > $clipY2 + 0.5) || (z_pos > $clipZ2 + 0.5) ||
        (x + radius < $clipX1 - 0.5) || (y + radius < $clipY1 - 0.5) || (z_pos < $clipZ1 - 0.5)) {
        return;
    }

    color   = $colorToUint16(color);
    outline = $colorToUint16(outline);

    $addGraphicsCommand({
        opcode: 'CIR',
        x: x,
        y: y,
        z: z_order,
        radius: radius,
        color: color,
        outline: outline
    });
}


function $debug_draw_arrow_arc(pos, angle_start, angle_end, label, label_subscript, color, shadow, z, radius = 100, head_pixels = 3, line_pixels = 1) {
    const vertex_array = [];

    // One segment per 10 degrees
    const segments = clamp($Math.abs(angle_end - angle_start) / 0.17, 2, 36);

    for (let i = 0; i < segments; ++i) {
        const a = (angle_start + i * (angle_end - angle_start) / (segments - 1)) * rotation_sign();
        vertex_array.push({x: $Math.cos(a) * radius + pos.x, y: $Math.sin(a) * radius + pos.y});
    }

    // Add an extra vertex to make the arrowhead aligned with the end angle rather
    // than the last segment.
    const last = vertex_array[vertex_array.length - 1];
    const a = angle_end + $Math.PI / 2 * rotation_sign() * sign(angle_end - angle_start); 
    const dir = {x: $Math.cos(a), y: $Math.sin(a)};
    vertex_array.push({x: last.x + 0.001 * dir.x, y: last.y + 0.001 * dir.y});

    $debug_draw_arrow_helper(vertex_array, label, label_subscript, color, shadow, z, head_pixels, line_pixels);
}


/* 
   Draw an arrow at `pos` along vector `vec` with optional `label` and `label_subscript` at the 
   arrowhead.

   Automatically adjusts the head_pixels and line_pixels for the current transformation scale.
   dir is NOT scaled by the current transformation because it is expected to be consistent with
   objects in the world.
   
   This is a debugging function because the output may change in future versions, it is not
   optimized for performance, and it lacks customization options such as fonts.
   */
function $debug_draw_arrow(pos, dir, label, label_subscript, color, shadow, z, dir_scale, head_pixels = 3, line_pixels = 1) {
    $debug_draw_arrow_helper([pos, $objectAdd(pos, $objectMul(dir, dir_scale))], label, label_subscript, color, shadow, z, head_pixels, line_pixels);
}


function $debug_draw_arrow_helper(vertex_array, label, label_subscript, color, shadow, z, head_pixels = 3, line_pixels = 1) {
    // Current transform scaling
    const scale = 1 / $zoom(z);

    if (line_pixels <= 1) {
        // Draw-line automatically scales "0" to be 1 pixel at the current transformation
        line_pixels = 0;
    }
    
    // One pixel in Y in camera space, for computing shadow and subscript offsets
    const a = -$camera.angle * rotation_sign(); 
    // One pixel on the screen-space negative Y axis, transformed into camera space
    const onePix = {x: -scale * $Math.sin(a) * up_y(), y: -scale * $Math.cos(a) * up_y()};
    if (shadow) {
        // Recursively draw the shadow underneath. Text performs its own shadowing, so pass nothing for the shadow
        // color
        $debug_draw_arrow_helper(vertex_array.map(v => $objectAdd(v, onePix)), undefined, undefined, shadow, undefined, z - 0.001, head_pixels, line_pixels);
    }

    const tip = vertex_array[vertex_array.length - 1];

    const dir = $objectSub(vertex_array[vertex_array.length - 1], vertex_array[vertex_array.length - 2]);
    for (let i = 0; i < vertex_array.length - 1; ++i) {
        draw_line(vertex_array[i], vertex_array[i + 1], color, z, line_pixels * scale);
    }
    draw_tri(xy(head_pixels, 0), xy(-head_pixels, head_pixels), xy(-head_pixels, -head_pixels), color, undefined, tip, xy_to_angle(dir), scale, z);

    if (label) {
        const separation = {x: scale * $Math.cos(a), y: -scale * $Math.sin(a)};
        // Move the label out of the way
        const d = perp(direction(dir));
        const label_pos =  {x: tip.x + scale * (head_pixels + 5) * d.x,
                            y: tip.y + scale * (head_pixels + 5) * d.y};
        // F
        draw_text({
            color: color,
            shadow: shadow,
            pos: label_subscript ? $objectSub(label_pos, separation) : label_pos,
            font: $font5,
            text: label,
            z: z + 0.01,
            x_align: label_subscript ? "right" : "center"});

        if (label_subscript) {
            // Subscript
            draw_text({
                color: color,
                shadow: shadow,
                pos: {x: label_pos.x + 3 * onePix.x + separation.x, y: label_pos.y + 3 * onePix.y + separation.y},
                font: $font5,
                text: label_subscript,
                z: z + 0.01,
                x_align: "left"});
        } // subscript
    } // label
}

/** Converts {r,g,b}, {r,g,b,a}, {h,s,v}, or {h,s,v,a} to a packed Uint16 of the
    form 0xABGR.
    
    Performance of this routine is critical, so it is kept
    very short to encourage inlining with the less-common
     case in a helper to encourage inlining of this 
 */
function $colorToUint16(color) {
    if (color === undefined) { return 0; }
    if (color.$color !== undefined) { return color.$color; }
    
    const color_a = color.a, color_r = color.r;
    const c = (color_a === undefined) ? 0xF000 : (((($clamp(color_a, 0, 1) * 15 + 0.5) & 0xf) << 12) >>> 0);
    
    if (color_r === undefined) { return $hsvaToUint16(color, c); }
    
    return (c | (($clamp(color.b, 0, 1) * 15 + 0.5) << 8) | (($clamp(color.g, 0, 1) * 15 + 0.5) << 4) | ($clamp(color_r, 0, 1) * 15 + 0.5)) >>> 0;
}


function $hsvaToUint16(color, c) {
    let r = 0, g = 0, b = 0, h = color.h;

    if (h !== undefined) {
        h = $loop(h, 0, 1);
        const s = $clamp(color.s, 0, 1), v = $clamp(color.v, 0, 1);

        // Convert to RGB
        // https://en.wikipedia.org/wiki/HSL_and_HSV#HSV_to_RGB
        let k = (5 + 6 * h) % 6;
        r = v - v * s * $Math.max(0, $Math.min(k, 4 - k, 1));

        k = (3 + 6 * h) % 6;
        g = v - v * s * $Math.max(0, $Math.min(k, 4 - k, 1));

        k = (1 + 6 * h) % 6;
        b = v - v * s * $Math.max(0, $Math.min(k, 4 - k, 1));
    }

    return (c | ((b * 15 + 0.5) << 8) | ((g * 15 + 0.5) << 4) | (r * 15 + 0.5)) >>> 0;
}


function draw_rect(pos, size, fill, border, angle, z) {
    if (pos === undefined) {
        $error('draw_rect() called on nil');
    }
    
    if (pos.pos) {
        z = pos.z;
        angle = pos.angle;
        border = pos.outline;
        fill = pos.color;
        size = pos.size;
        pos = pos.pos;
    }

    if (typeof size !== 'object' || size.x === undefined || size.y === undefined) {
        $error("The size argument to draw_rect() must be an xy() or have x and y properties.");
    }
    
    angle = loop(angle || 0, -$Math.PI, $Math.PI);

    const rx = size.x * 0.5, ry = size.y * 0.5;
    if (($camera.angle === 0) && ($Math.min($Math.abs(angle), $Math.abs(angle - $Math.PI), $Math.abs(angle + $Math.PI)) < 1e-10)) {
        // Use the corner rect case for speed
        draw_corner_rect({x:pos.x - rx, y:pos.y - ry, z:pos.z}, size, fill, border, z);
    } else if (($camera.angle === 0) && ($Math.min($Math.abs(angle - $Math.PI * 0.5), $Math.abs(angle + $Math.PI * 0.5)) < 1e-10)) {
        // Use the corner rect case for speed, rotated 90 degrees
        draw_corner_rect({x:pos.x - ry, y:pos.y - rx, z:pos.z}, {x:size.y, y:size.x}, fill, border, z);
    } else {
        const vertexArray = [{x:-rx, y:-ry}, {x:rx, y:-ry}, {x:rx, y:ry}, {x:-rx, y:ry}];
        // Undo the camera angle transformation, since draw_poly will apply it again
        draw_poly(vertexArray, fill, border, pos, angle, undefined, z);
    }
}


function draw_poly(vertexArray, fill, border, pos, angle, scale, z) {
    if ($skipGraphics) { return; }
    
    if (vertexArray.vertex_array) {
        z = vertexArray.z;
        scale = vertexArray.scale;
        angle = vertexArray.angle;
        pos = vertexArray.pos;
        border = vertexArray.outline;
        fill = vertexArray.color;
        vertexArray = vertexArray.vertex_array;
    }

    angle = (angle || 0) * rotation_sign();
    let Rx = $Math.cos(angle), Ry = $Math.sin(-angle);

    // Compute a per-vertex z value and average z-order
    const z_array = [];
    let z_order = 0;
    for (let i = 0; i < vertexArray.length; ++i) {
        let temp = vertexArray[i].z;
        if (temp === undefined) { temp = z || 0; }
        z_array[i] = temp;
        z_order += temp;
    }

    if (z !== undefined) {
        z_order = z;
    } else {
        z_order /= vertexArray.length;
    }
    
    // Clean up transformation arguments
    let Sx = 1, Sy = 1;

    if (scale !== undefined) {
        if (typeof scale === 'object') {
            Sx = scale.x; Sy = scale.y;
        } else {
            Sx = Sy = scale;
        }
    }

    let Tx = 0, Ty = 0, pos_z;
    if (pos) { Tx = pos.x; Ty = pos.y; pos_z = pos.z}

    switch (vertexArray.length) {
    case 0: return;
        
    case 1:
        {
            let p = vertexArray[0];
            if (pos) {
                if (p.z !== undefined) {
                    p = {x: Tx + p.x, y: Ty + p.y, z: (pos_z || 0) + p.z};
                } else {
                    p = {x: Tx + p.x, y: Ty + p.y};
                    if (pos_z !== undefined) {
                        p.z = pos_z;
                    }
                }
            }
            
            if (border) {
                draw_point(p, border, z);
            } else if (fill) {
                draw_point(p, fill, z);
            }
        }
        return;
        
    case 2:
        {
            let p = vertexArray[0];
            let q = vertexArray[1];
            if (pos || angle || (scale && scale !== 1)) {
                p = {x: Tx + p.x * Sx * Rx + p.y * Sy * Ry,
                     y: Ty + p.y * Sy * Rx - p.x * Sx * Ry,
                     z: (pos_z === undefined ? p.z : pos_z + (p.z || 0))};
                q = {x: Tx + q.x * Sx * Rx + q.y * Sy * Ry,
                     y: Ty + q.y * Sy * Rx - q.x * Sx * Ry,
                     z: (pos_z === undefined ? q.z : pos_z + (q.z || 0))};
            }

            if (border) {
                draw_line(p, q, border, z);
            } else if (fill) {
                draw_line(p, q, fill, z);
            }
        }
        return;
    }

    {
        const delta = (pos_z !== undefined) ? (pos_z - $camera.z) : $camera.z;
        z_order += delta;
        for (let i = 0; i < z_array.length; ++i) {
            z_array[i] += delta;
        }
    }
    
    // TODO: 3D
    if (($camera.x !== 0) || ($camera.y !== 0) || ($camera.angle !== 0)) {
        // Transform the arguments to account for the camera
        const C = $Math.cos($camera.angle),
              S = $Math.sin($camera.angle * rotation_sign());
        
        let x = Tx - $camera.x, y = Ty - $camera.y;
        Tx = x * C + y * S; Ty = y * C - x * S;
        angle -= $camera.angle * rotation_sign();

        // Update matrix
        Rx = $Math.cos(angle); Ry = $Math.sin(-angle);
    }
    // Preallocate the output array
    const N = vertexArray.length;
    const points = []; points.length = N * 2;

    // Compute the net transformation
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (let v = 0, p = 0; v < N; ++v, p += 2) {
        const vertex = vertexArray[v];
        const z = z_array[v];
        const mag = $zoom(z);        
        const skx = z * $skewXZ, sky = z * $skewYZ;
        
        // The object-to-draw and draw-to-screen transformations
        // could be concatenated to slightly reduce the amount of
        // math here, although it is maybe clearer and easier to debug
        // this way.
        
        // Object scale
        const Ax = vertex.x * Sx * mag,    Ay = vertex.y * Sy * mag;

        // Object rotate
        const Bx = Ax * Rx + Ay * Ry,      By = Ay * Rx - Ax * Ry;

        const Px = (Bx + Tx * mag + skx) * $scaleX + $offsetX;
        const Py = (By + Ty * mag + sky) * $scaleY + $offsetY;

        // Update bounding box
        minx = (Px < minx) ? Px : minx;    miny = (Py < miny) ? Py : miny;
        maxx = (Px > maxx) ? Px : maxx;    maxy = (Py > maxy) ? Py : maxy;
        
        points[p]     = Px;                points[p + 1] = Py;
    }

    // For clipping
    z_order = z_order * $scaleZ + $offsetZ;
    
    fill   = $colorToUint16(fill);
    border = $colorToUint16(border);

    // Culling/all transparent optimization
    if ((minx > $clipX2 + 0.5) || (miny > $clipY2 + 0.5) || (z_order < $clipZ1 - 0.5) ||
        (maxx < $clipX1 - 0.5) || (maxy < $clipY1 - 0.5) || (z_order > $clipZ2 + 0.5) ||
        !((fill | border) & 0xf000)) {
        return;
    }

    $addGraphicsCommand({
        opcode: 'PLY',
        points: points,
        z: z_order,
        color: fill,
        outline: border
    });
}


function draw_corner_rect(corner, size, fill, outline, z) {
    if ($skipGraphics) { return; }

    if (corner.corner) {
        if (size !== undefined) {
            $error('Named argument version of draw_corner_rect() must have only one argument');
        }
        size = corner.size;
        fill = corner.color;
        outline = corner.outline;
        z = corner.z;
        corner = corner.corner;
    }
    
    if ($Math.abs($camera.angle) >= 1e-10) {
        // Draw using a polygon because it is rotated
        draw_rect({x: corner.x + size.x * 0.5, y: corner.y + size.y * 0.5, z: corner.z}, size, fill, outline, 0, z);
        return;
    }

    if (z === undefined) { z = corner.z; }
    z = (z || 0) - $camera.z;
    let z_order = (corner.z === undefined) ? z : (corner.z - $camera.z);

    if (($camera.x !== 0) || ($camera.y !== 0)) {
        corner = {x: corner.x - $camera.x, y: corner.y - $camera.y};
    }

    if ($camera.zoom !== 1) {
        const m = $zoom(z);
        corner = {x: corner.x * m, y: corner.y * m};
        size = {x: size.x * m, y: size.y * m};
    }

    const skx = (z * $skewXZ), sky = (z * $skewYZ);
    let x1 = (corner.x + skx) * $scaleX + $offsetX, y1 = (corner.y + sky) * $scaleY + $offsetY;
    let x2 = (corner.x + size.x + skx) * $scaleX + $offsetX, y2 = (corner.y + size.y + sky) * $scaleY + $offsetY;
    z = z * $scaleZ + $offsetZ;
    z_order = z_order * $scaleZ + $offsetZ;

    fill = $colorToUint16(fill);
    outline = $colorToUint16(outline);

    // Sort coordinates
    let t1 = $Math.min(x1, x2), t2 = $Math.max(x1, x2);
    x1 = t1; x2 = t2;
    
    t1 = $Math.min(y1, y2), t2 = $Math.max(y1, y2);
    y1 = t1; y2 = t2;

    // Inclusive bounds for open top and left edges at the pixel center samples
    // low 0 -> 0, 0.5 -> 1
    // high 4 -> 3, 4.5 -> 4
    x1 = $Math.round(x1); y1 = $Math.round(y1);
    x2 = $Math.floor(x2 - 0.5); y2 = $Math.floor(y2 - 0.5);

    // Culling optimization
    if ((x2 < x1) || (y2 < y1) ||
        (x1 > $clipX2 + 0.5) || (x2 < $clipX1 - 0.5) || (z < $clipZ1 - 0.5) ||
        (y1 > $clipY2 + 0.5) || (y2 < $clipY1 - 0.5) || (z > $clipZ2 + 0.5)) {
        return;
    }

    const prevCommand = $graphicsCommandList[$graphicsCommandList.length - 1];
    if (prevCommand &&
        (prevCommand.baseZ === z_order) &&
        (prevCommand.opcode === 'REC') &&
        (prevCommand.clipX1 === $clipX1) && (prevCommand.clipX2 === $clipX2) &&
        (prevCommand.clipY1 === $clipY1) && (prevCommand.clipY2 === $clipY2)) {
        // Aggregate into the previous command
        prevCommand.data.push({
            x1: x1,
            y1: y1,
            x2: x2,
            y2: y2,
            fill: fill,
            outline: outline
        })
    } else {
        $addGraphicsCommand({
            z: z_order,
            baseZ: z_order,
            opcode: 'REC',
            data: [{
                x1: x1,
                y1: y1,
                x2: x2,
                y2: y2,
                fill: fill,
                outline: outline
            }]
        });
    }
}


// Compute the zoom for this z value for the current camera
function $zoom(z) {
    return typeof $camera.zoom === 'number' ? $camera.zoom : $camera.zoom(z);
}


function draw_line(A, B, color, z, width) {
    if ($skipGraphics) { return; }

    if (A.A) {
        width = A.width;
        z = A.z;
        color = A.color;
        B = A.B;
        A = A.A;
    }
    
    if (width === undefined) { width = 1; }

    let z_pos_A = A.z;
    let z_pos_B = B.z;
    let z_order = z;
    
    if (z_order === undefined) { z_order = z_pos_A; }
    if (z_order === undefined) { z_order = 0; }
    if (z_pos_A === undefined) { z_pos_A = z_order; }
    if (z_pos_B === undefined) { z_pos_B = z_order; }

    z_pos_A -= $camera.z;
    z_pos_B -= $camera.z;
    z_order -= $camera.z;

    const mag_A = $zoom(z_pos_A), mag_B = $zoom(z_pos_B);

    const zoomed_width = width * 0.5 * ($Math.abs(mag_A) + $Math.abs(mag_B));
    
    if ($Math.max($Math.abs(mag_A), $Math.abs(mag_B)) * width >= 1.5) {
        // Draw a polygon instead of a thin line, as this will
        // be more than one pixel wide in screen space. Do not
        // apply zooming as the polygon itself will do that.
        let delta_x = B.y - A.y, delta_y = A.x - B.x;
        let m = $Math.hypot(delta_x, delta_y);
        if (m < 0.001) { return; }
        m = width / (2 * m);
        delta_x *= m; delta_y *= m;
        draw_poly(
            [{x:A.x - delta_x * mag_A, y:A.y - delta_y * mag_A, z: A.z},
             {x:A.x + delta_x * mag_A, y:A.y + delta_y * mag_A, z: A.z},
             {x:B.x + delta_x * mag_B, y:B.y + delta_y * mag_B, z: B.z},
             {x:B.x - delta_x * mag_B, y:B.y - delta_y * mag_B, z: B.z}],
            color, undefined, undefined, undefined, undefined, z);
        return;
    }
    
    if (($camera.x !== 0) || ($camera.y !== 0) || ($camera.angle !== 0) || ($camera.zoom !== 1)) {
        // Transform the arguments to account for the camera
        const C = $Math.cos($camera.angle), S = $Math.sin($camera.angle * rotation_sign());
        let x = A.x - $camera.x, y = A.y - $camera.y;
        A = {x: (x * C + y * S) * mag_A, y: (y * C - x * S) * mag_A};
        
        x = B.x - $camera.x, y = B.y - $camera.y;
        B = {x: (x * C + y * S) * mag_B, y: (y * C - x * S) * mag_B};
        
        width = zoomed_width;
    }
    
    const x1 = (A.x + z_pos_A * $skewXZ) * $scaleX + $offsetX, y1 = (A.y + z_pos_A * $skewYZ) * $scaleY + $offsetY;
    const x2 = (B.x + z_pos_B * $skewXZ) * $scaleX + $offsetX, y2 = (B.y + z_pos_B * $skewYZ) * $scaleY + $offsetY;
    z_order = z_order * $scaleZ + $offsetZ;
    z_pos_A = z_pos_A * $scaleZ + $offsetZ;
    z_pos_B = z_pos_B * $scaleZ + $offsetZ;

    color = $colorToUint16(color);

    // Offscreen culling optimization
    if (! (color & 0xf000) ||
        ($Math.min(x1, x2) > $clipX2 + 0.5) || ($Math.max(x1, x2) < $clipX1 - 0.5) || ($Math.min(z_pos_A, z_pos_B) < $clipZ1 - 0.5) ||
        ($Math.min(y1, y2) > $clipY2 + 0.5) || ($Math.max(y1, y2) < $clipY1 - 0.5) || ($Math.max(z_pos_A, z_pos_B) > $clipZ2 + 0.5)) {
        return;
    }

    $addGraphicsCommand({
        opcode: 'LIN',
        x1: x1,
        x2: x2,
        y1: y1,
        y2: y2,
        z: z_order,
        color: color,
        open1: false,
        open2: false
    });
}


function draw_map_span(start, size, map, map_coord0, map_coord1, min_layer, max_layer_exclusive, replacement_array, z, override_color, override_blend, invert_sprite_y, quality) {
    if (size === undefined && 'x' in start && 'y' in start) {
        return draw_map_span(start.start, start.size, start.map,
                             start.map_coord0, start.map_coord1, start.min_layer, start.max_layer_exclusive,
                             start.replacement_array, start.z, start.override_color, start.override_blend,
                             start.invert_sprite_y, start.quality);
    }
    
    if ($skipGraphics) { return; }

    if (quality === undefined) { quality = 1.0; }

    // TODO: Remove when height spans are permitted
    if (size.y > 1) {
        $error('draw_map_span() size must be 1 or 0 along the y axis');
    }

    if (size.x > 1 && size.y > 1) {
        $error('draw_map_span() size must be zero or 1 along at most one dimension');
    }
    if (size.x < 0 || size.y < 0) {
        $error('draw_map_span() size must be nonnegative');
    }
    
    override_blend = override_blend || "lerp";

    if (min_layer === undefined) {
        min_layer = 0;
    }

    if (max_layer_exclusive === undefined) {
        max_layer_exclusive = map.layer.length >>> 0;
    }

    min_layer = $Math.ceil(min_layer) >>> 0;
    max_layer_exclusive = max_layer_exclusive >>> 0;

    if ((max_layer_exclusive <= 0) || (min_layer >= map.layer.length)) {
        // Nothing to do
        return;
    }

    let z_order = z, z_pos = start.z;
    if (z_order === undefined) { z_order = z_pos || 0; }
    if (z_pos === undefined) { z_pos = z_order; }
    z_pos -= $camera.z;
    z_order -= $camera.z;
    
    if (($camera.x !== 0) || ($camera.y !== 0) || ($camera.angle !== 0) || ($camera.zoom !== 1)) {
        // Transform the arguments to account for the camera
        const mag = (typeof $camera.zoom === 'number') ? $camera.zoom : $camera.zoom(z);
        const C = $Math.cos($camera.angle) * mag, S = $Math.sin($camera.angle * rotation_sign()) * mag;
        const x = start.x - $camera.x, y = start.y - $camera.y;
        start = {x: x * C + y * S, y: y * C - x * S};
        size.x *= mag;
        size.y *= mag;
    }
    
    const skx = z_pos * $skewXZ, sky = z_pos * $skewYZ;
    let x = (start.x + skx) * $scaleX + $offsetX, y = (start.y + sky) * $scaleY + $offsetY;
    z_pos = z_pos * $scaleZ + $offsetZ;
    z_order = z_order * $scaleZ + $offsetZ;
    
    x = $Math.floor(x) >>> 0; y = $Math.floor(y) >>> 0;
    let width = $Math.round(size.x);
    const height = $Math.round(size.y);

    // Completely clipped
    if ((z_pos < $clipZ1 - 0.5) || (z_pos >= $clipZ2 + 0.5) ||
        (x > $clipX2) || (x + width < $clipX1) ||
        (y < $clipY1) || (y + height > $clipY2)) {
        return;
    }

    // The time for this call is mostly spent in the draw call
    // submission, not the execution. So, time the submission and move
    // that time from the "logic" to the "graphics" profiler. Due to
    // the limited precision of browser timing the measured time will
    // frequently be zero, but this call is made about 100x per frame
    // in most implementations for floor or ceiling rendering, so
    // it will occasionally catch the timer ticking over and be right
    // on average.

    const startTime = $performance.now();
    
    // TODO: Support both width and height for clipping below

    // Compute derivatives before clipping width
    let map_point_x = map_coord0.x;
    let map_point_y = map_coord0.y;
    let step_x = (map_coord1.x - map_coord0.x) / width
    let step_y = (map_coord1.y - map_coord0.y) / width;

    // Clip left
    if (x < $clipX1) {
        const dx = $clipX1 - x;
        x = $clipX1 >>> 0;
        map_point_x += step_x * dx;
        map_point_y += step_y * dx;
        width -= dx;
    }

    // Clip right
    if (x + width - 1 > $clipX2) {
        const dx = x + width - 1 - $clipX2;
        width -= dx;
    }

    width = width >>> 0;

    const color = {r:0, g:0, b:0, a:0};
    
    if (override_color === undefined) {
        override_blend = false;
    } else {
        override_blend = override_blend || "lerp";
        override_color = rgba(override_color);

        if ((override_blend === "lerp" && override_color.a < 1/32) ||
            (override_blend === "multiply" && $Math.min(override_color.r, override_color.g, override_color.b) > 0.96)) {
            // Blending will have no visible effect but will be slow, so disable it
            override_blend = false;
        }
    }

    // Preallocate the encoded span array for the graphics
    // command. Using a typed array seems to reduce garbage collection
    // substantially, even though it doesn't actually affect the
    // average cost of the writes or reads.
    //
    // Allocate the worst case, which is a series of blocks of length 1.
    //
    // Alternates header blocks and value blocks. For each block, the header
    // element specifies:
    //
    // - header & 0x1 is 1 if the entire block has alpha = 0xf and can be memcpy'd
    // - header & 0x2 is 1 if the block has alpha = 0x0 (in which case, there is
    //              no actual data in the block)
    // - header >> 2 is the length of the span.
    const color_data = new Uint16Array(2 * width);
    
    // Actually used elements (we always use the first element)
    let color_data_length = 1 >>> 0;

    if (invert_sprite_y === undefined) {
        invert_sprite_y = $scaleY < 0;
    }

    // Index in color_data where there the run (block) began
    let run_start_index = 0;

    // AND of all of the pixel_values for this run.
    // Only the alpha channel is actually used.
    let run_mask    = 0xffff;
    let run_is_skip = false;
    let run_length  = 0;

    const low_res = quality <= 0.5;
    let prev_read = -1;
    
    // Draw the scanline. Because it has constant camera-space z, the 
    // texture coordinate ("read_point") interpolates linearly
    // under perspective projection.
    for (let i = 0;
         i < width;
         ++i, map_point_x += step_x, map_point_y += step_y) {

        let pixel_value;

        if (low_res && (i & 1) === 0 && (prev_read !== -1)) {
            // Reuse the previous value to avoid the most expensive
            // part, which is the get_map_pixel_color() call. This could
            // be exploited further by having the actual runs be encoded
            // at half resolution, reducing the data transfer and storage
            // and making the RIGHT edges more consistent.
            pixel_value = prev_read;
        } else {
            // Call the low-level version, which avoids conversion to rgba() in the common case.
            // Nearly all of the time of this routine (including the actual drawing) is spent in
            // the following call.
            pixel_value = $get_map_pixel_color(map, map_point_x, map_point_y, min_layer, max_layer_exclusive, replacement_array, color, invert_sprite_y);
            prev_read = pixel_value;
        }

        if (pixel_value === -1) {
            if (! run_is_skip) {
                if (i > 0) {
                    // Complete the previous run
                    color_data[run_start_index] =
                        (run_length << 2) |
                        (((run_mask & 0xf000) === 0xf000) ? 1 : 0);
                    run_length = 0;
                    // Consume a new element
                    run_start_index = color_data_length++;
                }
                run_is_skip = true;
            }
            
            // Skip ahead to the next map cell because this one is
            // empty. This is a 15% net performance improvement for
            // rendering sparse hallway floors.
            const mx = $Math.floor(map_point_x), my = $Math.floor(map_point_y);

            // Just skip without even writing, since everything is transparent
            const before = i;
            for (; (i < width) && (mx === $Math.floor(map_point_x)) && (my === $Math.floor(map_point_y));
                 ++i, map_point_x += step_x, map_point_y += step_y) {
            }
            // The iterator will necessarily go one step too far, so
            // back everything up before the master iterator hits
            --i; map_point_x -= step_x; map_point_y -= step_y;

            // We're now at the end of this map cell
            run_length += i - before;
            
        } else {
            // Not in a skip. End the previous run if it was a skip
            if (run_is_skip) {
                color_data[run_start_index] = (run_length << 2) | 0x2;
                run_length = 0;
                run_is_skip = false;
                run_mask = 0xffff;
                // Consume a new element
                run_start_index = color_data_length++;
            }

            if (override_blend) {
                if (pixel_value >= 0) {
                    // Compute color from pixel, as it is not present yet
                    // because $get_pixel_color() used an optimized path.
                    color.a = ((pixel_value >>> 12) & 0xf) * (1 / 15);
                    color.b = ((pixel_value >>> 8) & 0xf) * (1 / 15);
                    color.g = ((pixel_value >>> 4) & 0xf) * (1 / 15);
                    color.r = (pixel_value & 0xf) * (1 / 15);
                    pixel_value = -2;
                }
                
                // The following surprisingly seem to cost almost
                // nothing, so we do not optimize them by performing
                // operations in fixed point.
                if (override_blend === "lerp") {
                    RGB_LERP(color, override_color, override_color.a, color);
                } else { // Multiply
                    RGB_MUL_RGB(color, override_color, color);
                }
            }
            
            // -2 = value in color
            pixel_value = pixel_value < 0 ? $colorToUint16(color) : pixel_value;

            run_mask &= pixel_value;
            color_data[color_data_length++] = pixel_value;
            ++run_length;
        } // if sprite present
    } // for i

    // End the last run
    if (run_is_skip) {
        color_data[run_start_index] = (run_length << 2) | 0x2;
    } else {
        color_data[run_start_index] = (run_length << 2) | (((run_mask & 0xf000) === 0xf000) ? 1 : 0);
    }

    $addGraphicsCommand({
        z: z_order,
        baseZ: z_order,
        opcode: 'SPN',
        x: x,
        y: y,
        dx: 1,
        dy: 0,
        data_length: color_data_length,
        data: color_data})

    $logicToGraphicsTimeShift += $performance.now() - startTime;
}


function draw_point(pos, color, z) {
    if ($skipGraphics) { return; }
    
    if (pos.pos) {
        // Named argument version
        z = pos.z;
        color = pos.color;
        pos = pos.pos;
    }

    color = $colorToUint16(color);

    // Completely transparent, nothing to render!
    if (color & 0xF000 === 0) { return; }

    if (z === undefined) {
        z = pos.z;
        if (z === undefined) {
            z = 0;
        }
    }
    z -= $camera.z;
    let z_order = (pos.z === undefined) ? z : (pos.z - $camera.z);

    if (($camera.x !== 0) || ($camera.y !== 0) || ($camera.angle !== 0) || ($camera.zoom !== 1)) {
        // Transform the arguments to account for the camera
        const mag = (typeof $camera.zoom === 'number') ? $camera.zoom : $camera.zoom(z);
        const C = $Math.cos($camera.angle) * mag, S = $Math.sin($camera.angle * rotation_sign()) * mag;
        const x = pos.x - $camera.x, y = pos.y - $camera.y;
        pos = {x: x * C + y * S, y: y * C - x * S};
    }
    
    const skx = z * $skewXZ, sky = z * $skewYZ;
    let x = (pos.x + skx) * $scaleX + $offsetX, y = (pos.y + sky) * $scaleY + $offsetY;
    z = z * $scaleZ + $offsetZ;
    z_order = z_order * $scaleZ + $offsetZ;
    
    x = $Math.floor(x) >>> 0; y = $Math.floor(y) >>> 0;
    
    if ((z < $clipZ1 - 0.5) || (z >= $clipZ2 + 0.5) ||
        (x < $clipX1) || (x > $clipX2) ||
        (y < $clipY1) || (y > $clipY2)) {
        return;
    }

    const prevCommand = $graphicsCommandList[$graphicsCommandList.length - 1];
    if (prevCommand && (prevCommand.baseZ === z_order) && (prevCommand.opcode === 'PIX')) {
        // Many points with the same z value are often drawn right
        // after each other.  Aggregate these (preserving their
        // ordering) for faster sorting and rendering.
        prevCommand.data.push((x + y * ($SCREEN_WIDTH >>> 0)) >>> 0, color); 
    } else {
        $addGraphicsCommand({
            z: z_order,
            baseZ: z_order,
            opcode: 'PIX',
            data: [(x + y * ($SCREEN_WIDTH >>> 0)) >>> 0, color]
        });
    }
}


function text_width(font, str, markup) {
    if (str === '') { return 0; }
    if (font === undefined || font.$type !== 'font') {
        $error('The first argument to text_width() must be a font.');
    }
    if (str === undefined) {
        $error('text_width() requires a valid string as the second argument');
    }

    let formatArray = [{font: font, color: 0, shadow: 0, outline: 0, startIndex: 0}];
    if (markup) {
        str = $parseMarkup(str, formatArray);
    }

    // Don't add space after the last letter
    let width = -font.spacing.x;
    
    // Add the variable widths of the letters. Don't count the border
    // against the letter width.
    
    let formatIndex = 0;
    let offsetIndex = 0;
    while ((offsetIndex < formatArray[formatIndex].startIndex) || (offsetIndex > formatArray[formatIndex].endIndex)) { ++formatIndex; }
    let format = formatArray[formatIndex];

    for (let c = 0; c < str.length; ++c) {
        const chr = $fontMap[str[c]] || ' ';
        const bounds = font.$bounds[chr];
        width += (bounds.x2 - bounds.x1 + 1) + $postGlyphSpace(chr + ($fontMap[str[c]] || ''), format.font) - font.$borderSize * 2 + bounds.pre + bounds.post;
        
        if (offsetIndex === formatArray[formatIndex].endIndex) {
            // Advance to the next format
            ++formatIndex;
            if (formatIndex < formatArray.length) {
                // Hold the final format when going off the end of the array
                format = formatArray[formatIndex];
            }
        }
    }
 
    return width;    
}


// Returns a string and appends to the array of state changes.
// Each has the form {color:..., outline:..., shadow:..., font:..., startIndex:...}
function $parseMarkupHelper(str, startIndex, stateChanges) {

    // Find the first unescaped {, or return if there is none
    let start = -1;
    do {
        start = str.indexOf('{', start + 1);
        if (start === -1) {
            // No markup found
            return str;
        }
    } while ((start !== 0) && (str[start - 1] === '\\'));

    // Find the *matching* close brace
    let end = start;
    let stack = 1;
    while (stack > 0) {
        let op = str.indexOf('{', end + 1); if (op === -1) { op = Infinity; }
        let cl = str.indexOf('}', end + 1); if (cl === -1) { cl = Infinity; }
        end = $Math.min(op, cl);
        
        if (end >= str.length) {
            $error('Unbalanced {} in draw_text() with markup');
        }
        
        if (str[end - 1] !== '\\') {
            // Not escaped
            switch (str[end]) {
            case '{': ++stack; break;
            case '}': --stack; break;
            }
        }
    }

    const before = str.substring(0, start);
    const after  = str.substring(end + 1);
    const markup = str.substring(start + 1, end);

    let wasColor = false;
    const oldState = stateChanges[stateChanges.length - 1];
    const newState = Object.assign({}, oldState);
    newState.startIndex = startIndex + start;

    // Parse the markup
    let text = markup.replace(/^\s*(color|shadow|outline)\s*:\s*(#[A-Fa-f0-9]+|(rgb|rgba|gray|hsv|hsva)\([0-9%., ]+\))\s*/, function (match, prop, value) {
        wasColor = true;
        if (value[0] === '#') {
            value = $parseHexColor(value.substring(1));
        } else {
            // Parse the color specification
            let i = value.indexOf('(');

            // (Could also use $parse's indexing arguments to avoid all of this string work)
            const type = value.substring(0, i).trim();
            const param = value.substring(i + 1, value.length - 1).split(',');
            // Parse all parameters
            for (let i = 0; i < param.length; ++i) { param[i] = $parse(param[i].trim()).result; }

            // Convert to a structure
            switch (type) {
            case 'rgb':  value = {r:param[0], g:param[1], b:param[2]}; break;
            case 'rgba': value = {r:param[0], g:param[1], b:param[2], a:param[3]}; break;
            case 'hsv':  value = {h:param[0], s:param[1], v:param[2]}; break;
            case 'hsva': value = {h:param[0], s:param[1], v:param[2], a:param[3]}; break;
            case 'gray': value = {h:param[0]}; break;
            }
        }
        newState[prop] = $colorToUint16(value);
        return '';
    });

    if (! wasColor) {
        // The argument is not a color literal. It should be an identifier,
        // so parse it in the same way as the compiler
        //
        // The identifier regexp here is copied from
        // pyxlscript-compiler.js identifierPattern and must be kept
        // in sync.
        text = markup.replace(/^\s*(font|color|shadow|outline)\s*:\s*([Δ]?(?:[_A-Za-z][A-Za-z_0-9]*|[αβγΔδζηθιλμρσϕφχψτωΩ][_0-9]*(?:_[A-Za-z_0-9]*)?))\s+/, function (match, prop, value) {
            let v = window[value];
            if (v === undefined) {
                $error('Global constant ' + value + ' used in draw_text markup is undefined.');
            } else if (prop === 'font' && v.$type !== 'font') {
                $error('Global constant ' + value + ' is not a font'); 
            } else if (prop !== 'font' && v.r === undefined && v.h === undefined) {
                $error('Global constant ' + value + ' is not a color');
            }

            if (prop !== 'font') {
                v = $colorToUint16(v);
            }
            
            newState[prop] = v;
            return '';
        });
    }

    // Construct the new result string
    
    // The before part cannot contain markup, so copy it directly
    str = before;

    // Recursively process the main body
    stateChanges.push(newState);
    text = $parseMarkupHelper(text, before.length + startIndex, stateChanges);
    str += text;
    
    // Restore the old state after the body
    const restoreState = Object.assign({}, oldState);
    restoreState.startIndex = before.length + text.length + startIndex;
    stateChanges.push(restoreState);

    // Is there more after the first markup?
    if (after !== '') {
        str += $parseMarkupHelper(after, restoreState.startIndex, stateChanges);
    }

    return str;
}


function $parseMarkup(str, stateChanges) {
    // First instance.
    
    // Remove single newlines, temporarily protecting paragraph breaks.
    str = str.replace(/ *\n{2,}/g, '¶');
    str = str.replace(/ *\n/g, ' ');
    str = str.replace(/¶/g, '\n\n');

    // Convert {br} to a newline
    str = str.replace(/\{br\}/g, '\n');

    str = $parseMarkupHelper(str, 0, stateChanges);

    // Efficiently remove degenerate state changes and compact
    {
        let src, dst;
        for (src = 0, dst = 0; src < stateChanges.length - 1; ++src) {
            if (src !== dst) { stateChanges[dst] = stateChanges[src]; }
            
            // Do not overwrite if this and the next element differ
            if (stateChanges[src].startIndex !== stateChanges[src + 1].startIndex) { ++dst; }
        }

        // Remove the remaining elements
        stateChanges.splice(dst, src - dst);
    }
    
    // Update the end indices (which are inclusive)
    for (let i = 0; i < stateChanges.length - 1; ++i) {
        stateChanges[i].endIndex = stateChanges[i + 1].startIndex - 1;
        // Width of this section, to be computed later
        stateChanges[i].width = 0;
    }
    // Force the last element to end at the string end
    stateChanges[stateChanges.length - 1].endIndex = str.length - 1;
    stateChanges[stateChanges.length - 1].width = 0;
    
    return str;
}


/** Helper for draw_text() that operates after markup formatting has been processed. 
    offsetIndex is the amount to add to the indices in formatArray to account for
    the str having been shortened already. 

*/
function $draw_text(offsetIndex, formatIndex, str, formatArray, pos, z_pos, x_align, y_align, z_order, wrap_width, text_size, referenceFont) {
    $console.assert(typeof str === 'string');
    $console.assert(Array.isArray(formatArray));
    $console.assert(formatIndex < formatArray.length);
    $console.assert(typeof pos === 'object' && pos.x !== undefined);

    let format;
    if ((offsetIndex < formatArray[formatIndex].startIndex) ||
        (offsetIndex > formatArray[formatIndex].endIndex)) {
        // Empty, just return newline
        return {size: {x:0, y:referenceFont.$charHeight}}; // TODO: pos
    }
    
    // Identify the starting format. This snippet is repeated throughout the function.
    while ((offsetIndex < formatArray[formatIndex].startIndex) || (offsetIndex > formatArray[formatIndex].endIndex)) { ++formatIndex; }
    format = formatArray[formatIndex];

    // Store this starting formatIndex
    const startingOffsetIndex = offsetIndex;
    const startingFormatIndex = formatIndex;

    // Compute the width of the string for alignment purposes,
    // terminating abruptly in a recursive call if word wrapping is
    // required.
    let width = 0, currentWidth = 0;
    for (let c = 0; c < str.length; ++c, ++offsetIndex) {
        if (str[c] === '\n') {
            // Newline, process by breaking and recursively continuing
            const cur = str.substring(0, c).trimEnd();
            const firstLineBounds = $draw_text(startingOffsetIndex, startingFormatIndex, cur, formatArray, pos, z_pos, x_align, y_align, z_order, wrap_width, text_size, referenceFont);

            ++offsetIndex;
            // Update formatIndex if needed as well
            while ((offsetIndex < formatArray[formatIndex].startIndex) ||
                   (offsetIndex > formatArray[formatIndex].endIndex)) {
                ++formatIndex;
                
                if (formatIndex >= formatArray.length) {
                    // Nothing left
                    return firstLineBounds;
                }
            }

            $console.assert(formatIndex < formatArray.length);

            const restBounds = $draw_text(
                offsetIndex, formatIndex, str.substring(c + 1),
                formatArray, {x:pos.x, y:pos.y + referenceFont.line_height / $scaleY},
                z_pos, x_align, y_align, z_order, wrap_width, text_size - c - 1, referenceFont);
            // TODO: pos
            firstLineBounds.size.x = $Math.max(firstLineBounds.size.x, restBounds.size.x);
            if (restBounds.size.y > 0) {
                firstLineBounds.size.y += referenceFont.spacing.y + restBounds.size.y;
            }
            return firstLineBounds;
        }
        
        const chr = $fontMap[str[c]] || ' ';
        const bounds = format.font.$bounds[chr];

        const delta = (bounds.x2 - bounds.x1 + 1) + $postGlyphSpace(chr + ($fontMap[str[c + 1]] || ''), format.font) - format.font.$borderSize * 2 + bounds.pre + bounds.post;
        currentWidth += delta;
        width += delta;

        // Word wrapping
        if ((wrap_width !== undefined) && (wrap_width > 0) && (width > wrap_width - format.font.spacing.x)) {
            // Perform word wrap, we've exceeded the available width
            // Search backwards for a place to break.
            const breakChars = ' \n\t,.!:/\\)]}\'"|`-+=*…\?¿¡';

            // Avoid breaking more than 25% back along the string
            const maxBreakSearch = $Math.max(1, (c * 0.25) | 0);
            let breakIndex = -1;
            for (let i = 0; (breakIndex < maxBreakSearch) && (i < breakChars.length); ++i) {
                breakIndex = $Math.max(breakIndex, str.lastIndexOf(breakChars[i], c));
            }
            
            if ((breakIndex > c) || (breakIndex < maxBreakSearch)) {
                // Give up and break at c
                breakIndex = c;
            }

            const cur = str.substring(0, breakIndex);          
            const firstLineBounds = $draw_text(startingOffsetIndex, startingFormatIndex, cur.trimEnd(), formatArray, pos, z_pos, x_align, y_align, z_order, undefined, text_size, referenceFont);
            
            // Now draw the rest
            const next = str.substring(breakIndex);
            const nnext = next.trimStart();

            // Update the offset and formatIndex for the recursive call. Note that
            // we have to account for the extra whitespace trimmed from nnext
            offsetIndex = startingOffsetIndex + breakIndex + (next.length - nnext.length);

            // Search for the appropriate formatIndex
            formatIndex = startingFormatIndex;
            while ((offsetIndex < formatArray[formatIndex].startIndex) || (offsetIndex > formatArray[formatIndex].endIndex)) { ++formatIndex; }
            format = undefined;

            $console.assert(offsetIndex >= formatArray[formatIndex].startIndex && offsetIndex <= formatArray[formatIndex].endIndex);
            const restBounds = $draw_text(offsetIndex, formatIndex, nnext, formatArray, {x:pos.x, y:pos.y + referenceFont.line_height / $scaleY}, z_pos,
                                          x_align, y_align, z_order, wrap_width, text_size - cur.length - (next.length - nnext.length), referenceFont);

            // TODO: pos
            firstLineBounds.size.x = $Math.max(firstLineBounds.size.x, restBounds.size.x);
            if (restBounds.size.y > 0) {
                firstLineBounds.size.y += referenceFont.spacing.y + restBounds.size.y;
            }
            return firstLineBounds;
        }
        
        if (offsetIndex === formatArray[formatIndex].endIndex) {
            // Advance to the next format
            format.width = currentWidth;
            currentWidth = 0;
            ++formatIndex;
            if (formatIndex < formatArray.length) {
                // Hold the final format when going off the end of the array
                format = formatArray[formatIndex];
            }
        }
    }

    // Don't add space after the very last letter
    width -= format.font.spacing.x;
    format.width -= format.font.spacing.x;

    const skx = (z_pos * $skewXZ), sky = (z_pos * $skewYZ);
    let x = (pos.x + skx) * $scaleX + $offsetX, y = (pos.y + sky) * $scaleY + $offsetY;
    z_pos = z_pos * $scaleZ + $offsetZ;
    z_order = z_order * $scaleZ + $offsetZ;

    const height = referenceFont.$charHeight;

    // Force alignment to retain relative integer pixel alignment.
    // The - 0.4999 is to align with rectangle and disk centering rules.
    x = $Math.round(x - width * (1 + x_align) * 0.5);

    // Move back to account for the border and shadow padding
    if (typeof x_align === 'string') { throw 'bad x'; }
    if (x_align !== +1) { --x; }

    switch (y_align) {
    case -1: y -= referenceFont.$borderSize; break; // Align to the top of the bounds
    case  0:
        // Middle. Center on a '2', which tends to have a typical height 
        const bounds = referenceFont.$bounds['2'];
        const tileY = $Math.floor(bounds.y1 / referenceFont.$charHeight) * referenceFont.$charHeight;
        y -= $Math.round((bounds.y1 + bounds.y2) / 2) - tileY;
        break;
    case  1: y -= referenceFont.$baseline; break; // baseline
    case  2: y -= (referenceFont.$charHeight - referenceFont.$borderSize * 2 - referenceFont.$shadowSize); break; // bottom of bounds
    }


    // Center and round. Have to call round() because values may
    // be negative
    x = $Math.round(x) | 0;
    y = $Math.round(y) | 0;

    if ((x > $clipX2) || (x + width < $clipX1) ||
        (z_pos > $clipZ2 + 0.5) || (z_pos < $clipZ1 - 0.5) ||
        (y_align !== 2 && (y > $clipY2) || (y + height < $clipY1))) {
        // Cull when off-screen. Culling is disabled for "bottom" aligned
        // text because the implementation generatse a draw call and then
        // adjust the vertical position, so culling cannot happen during draw call
        // generation.
    } else {
        // Break by formatting and then re-traverse the formatting array.
        // Reset to the original formatIndex, since it was previously
        // incremented while traversing the string to compute width.
        offsetIndex = startingOffsetIndex;
        formatIndex = startingFormatIndex;
        format = formatArray[formatIndex];

        str = str.substring(0, text_size);

        while ((str.length > 0) && (formatIndex < formatArray.length)) {
            // offsetIndex increases and the string itself is
            // shortened throughout this loop.
    
            // Adjust for the baseline relative to the reference font
            const dy = format.font.$baseline - referenceFont.$baseline;

            const endIndex = format.endIndex - offsetIndex;

            let mappedStr = '';
            for (let i = 0; i <= endIndex; ++i) {
                mappedStr += $fontMap[str[i]] || ' ';
            }
            
            $addGraphicsCommand({
                opcode:  'TXT',
                str:     mappedStr,
                fontIndex: format.font.$index[0],
                x:       x,
                y:       y - dy,
                z:       z_order,
                color:   format.color,
                outline: format.outline,
                shadow:  format.shadow,
                height:  height,
                width:   format.width,
            });

            x += format.width;

            // Should adjust for the relative y baselines of the fonts,
            // changing the returned bounds accordingly

            offsetIndex = format.endIndex + 1;

            // Process the characters immediately after the end index.
            str = str.substring(endIndex + 1);
            
            ++formatIndex;
            format = formatArray[formatIndex];
        }
    }

    // The height in memory is inflated by 3 for the outline on top
    // and shadow and outline on the bottom. Return the tight
    // bound on the characters themselves.
    return {size: {x: width, y: height - 3}};
}


/** Processes formatting and invokes $draw_text() */
function draw_text(font, str, pos, color, shadow, outline, x_align, y_align, z, wrap_width, text_size, markup) {
    // Cannot skip in off frames because it has a return value
    
    if (font && (font.text !== undefined || font.font !== undefined || font.pos !== undefined)) {
        // Keyword version
        text_size = font.text_size;
        wrap_width = font.wrap_width;
        z = font.z;
        y_align = font.y_align;
        x_align = font.x_align;
        outline = font.outline;
        shadow = font.shadow;
        color = font.color;
        pos = font.pos;
        str = font.text;
        markup = font.markup;
        font = font.font;
    }

    if (font === undefined) {
        // Default font
        font = $font8;
    }
    
    if (font.$url === undefined) {
        $error('draw_text() font argument must be a font or nil');
    }
    
    if (pos === undefined) {
        $error('draw_text() requires a pos');
    }

    if (typeof str !== 'string') {
        str = unparse(str);
    }
    
    let z_order = z;
    if (z_order === undefined) { z_order = pos.z; }
    if (z_order === undefined) { z_order = 0; }
    let z_pos = pos.z;
    if (z_pos === undefined) { z_pos = z_order; }

    z_order -= $camera.z;
    z_pos -= $camera.z;

    if (($camera.x !== 0) || ($camera.y !== 0) || ($camera.angle !== 0) || ($camera.zoom !== 1)) {
        // Transform the arguments to account for the camera
        const mag = $zoom(z_pos);
        const C = $Math.cos($camera.angle) * mag, S = $Math.sin($camera.angle * rotation_sign()) * mag;
        const x = pos.x - $camera.x, y = pos.y - $camera.y;
        pos = {x: x * C + y * S, y: y * C - x * S};
    }

    if (str === '') { return {pos: {x:pos.x, y:pos.y}, size: {x: 0, y: 0}, height:0, z:z_order}; }
    
    const stateChanges = [{
        font:       font,
        color:      $colorToUint16(color),
        shadow:     $colorToUint16(shadow),
        outline:    $colorToUint16(outline),
        startIndex: 0,
        endIndex:   str.length - 1
    }];
    
    if (markup) {
        str = $parseMarkup(str, stateChanges);
    }

    if (text_size === undefined) {
        text_size = str.length;
    }

    switch (x_align) {
    case 'middle': case 'center': x_align = 0; break;
    case 'right':  x_align = +1; break;
    case 'left': x_align = -1; break;
    default:
        if (x_align !== 0 && x_align !== 1 && x_align !== -1) {
            x_align = 0;
        }
        break;
    }

    switch (y_align) {
    case 'top': y_align = -1; break;
    case 'center': case 'middle': y_align = 0; break;
    case 'bottom': y_align = +2; break;
    case 'baseline': y_align = +1; break;
    default:
        if (y_align !== 0 && y_align !== 1 && y_align !== -1 && y_align !== 2) {
            y_align = 0;
        }
        
    }
    
    // Debug visualize the markup:
    /*
    if (markup) {
        for (let i = 0; i < stateChanges.length; ++i) {
            $console.log(str.substring(stateChanges[i].startIndex, stateChanges[i].endIndex + 1), stateChanges[i]);
        }
    }
    */

    // Track draw calls generated by $draw_text
    const first_graphics_command_index = $graphicsCommandList.length;
    const bounds = $draw_text(0, 0, str, stateChanges, pos, z_pos, x_align, y_align, z_order, wrap_width, text_size, font);

    if (first_graphics_command_index === $graphicsCommandList.length) {
        // Drew nothing!
        return {pos:{x:pos.x, y:pos.y}, size:{x:0, y:0}, height:bounds.size.y, z:z_order};
    }

    // Compute bounds in screen space
    {
        let i = first_graphics_command_index;
        bounds.pos = {x: $graphicsCommandList[i].x, y: $graphicsCommandList[i].y};
        ++i;
        while (i < $graphicsCommandList.length) {
            bounds.pos.x = $Math.min(bounds.pos.x, $graphicsCommandList[i].x);
            bounds.pos.y = $Math.min(bounds.pos.y, $graphicsCommandList[i].y);
            ++i;
        }
        
        // Move to the center
        bounds.pos.x += 0.5 * bounds.size.x + 0.5;
        bounds.pos.y += 0.5 * bounds.size.y + 0.5;
    }
    bounds.z = z_order;

    if ((bounds.size.y > font.line_height) && (y_align === 0 || y_align === 2)) {
        let y_shift = 0;
        if (y_align === 0) {
            // Center
            y_shift = 0.5 * (font.line_height - bounds.size.y);
        } else {
            // Bottom
            y_shift = font.line_height - bounds.size.y;
        }
        bounds.pos.y += y_shift;
        
        // Multiline needing vertical adjustment. Go back to the issued
        // draw calls and shift them vertically as required.
        for (let i = first_graphics_command_index; i < $graphicsCommandList.length; ++i) {
            $graphicsCommandList[i].y += y_shift;
        }
    }

    // Preserve the height for layout
    bounds.height = bounds.size.y;
    
    // Enforce the clipping region on the bounds
    {
        let minX = $Math.max(bounds.pos.x - 0.5 * bounds.size.x, $clipX1);
        let maxX = $Math.min(bounds.pos.x + 0.5 * bounds.size.x, $clipX2);
        let minY = $Math.max(bounds.pos.y - 0.5 * bounds.size.y, $clipY1);
        let maxY = $Math.min(bounds.pos.y + 0.5 * bounds.size.y, $clipY2);

        bounds.pos.x = 0.5 * (maxX + minX);
        bounds.size.x = maxX - minX;
        bounds.pos.y = 0.5 * (maxY + minY);
        bounds.size.y = maxY - minY;
        if (bounds.size.x <= 0 || bounds.size.y <= 0) {
            bounds.size.x = bounds.size.y = bounds.pos.x = bounds.pos.y = NaN;
        }
    }
    
    // Convert screen space pos to camera space
    bounds.pos.x = (bounds.pos.x - $offsetX) / $scaleX - bounds.z * $skewXZ;
    bounds.pos.y = (bounds.pos.y - $offsetY) / $scaleY - bounds.z * $skewYZ;
    
    return bounds;
}

/* Used by the on-screen profiler HUD */
function $onScreenDrawBarGraph(title, value, color, i) {
    const y1 = i * 14 + 1;
    $addGraphicsCommand({
        opcode: 'REC',
        z: 3099,
        baseZ: 3099,
        data: [{x1: 0, y1: y1, x2: $Math.min($Math.floor(SCREEN_SIZE.x * value / 18), SCREEN_SIZE.x - 1), y2: y1 + 12, fill: color, outline:0xF000}],
        clipX1:  0,
        clipY1:  0,
        clipX2:  SCREEN_SIZE.x - 1,
        clipY2:  SCREEN_SIZE.y - 1
    });
    
    $addGraphicsCommand({
        opcode:  'TXT',
        str:     title + ' ' + format_number(value, ' 0.0') + 'ms',
        fontIndex: $font8.$index[0],
        x:       1,
        y:       y1,
        z:       4000,
        color:   0xF000,
        outline: color,
        shadow:  0,
        height:  10,
        width:   100,
        clipX1:  0,
        clipY1:  0,
        clipX2:  SCREEN_SIZE.x - 1,
        clipY2:  SCREEN_SIZE.y - 1
    });
}


/* Returns a shallow copy */
function $clone(a) {
    if (a instanceof Array) {
        return a.slice();
    } else if (typeof a === 'Object') {
        return Object.assign({}, a);
    } else {
        return a;
    }
}


// Slightly faster than $Math.max($Math.min(x, H), L) on Chrome
function $clamp(x, L, H) {
    return (x < L) ? L : (x > H) ? H : x;
}


function sprite_pixel_color(spr, pos, result) {
    if (! (spr && spr.$spritesheet)) {
        $error('Called sprite_pixel_color() on an object that was not a sprite asset. (' + unparse(spr) + ')');
    }

    const x = ((spr.scale.x > 0) ? pos.x : (spr.size.x - 1 - pos.x)) | 0;
    const y = ((spr.scale.y > 0) ? pos.y : (spr.size.y - 1 - pos.y)) | 0;
    
    if ((x < 0) || (x >= spr.size.x) || (y < 0) || (y >= spr.size.y)) {
        if (result) {
            result.a = result.r = result.g = result.b = 0;
        } else {
            return undefined;
        }
    } else {
        const data = spr.$spritesheet.$uint16Data;
        const pixel = data[((spr.$x >>> 0) + x) + ((spr.$y >>> 0) + y) * (data.width >>> 0)] >>> 0;

        result = result || {r:0, g:0, b:0, a:0};
        
        result.a = ((pixel >>> 12) & 0xf) * (1 / 15);
        result.b = ((pixel >>> 8) & 0xf) * (1 / 15);
        result.g = ((pixel >>> 4) & 0xf) * (1 / 15);
        result.r = (pixel & 0xf) * (1 / 15);
        
        return result;
    }
}

var get_sprite_pixel_color = sprite_pixel_color;


function draw_sprite_corner_rect(CC, corner, size, z) {
    if ($skipGraphics) { return; }
    
    if (! (CC && CC.$spritesheet)) {
        $error('Called draw_sprite_corner_rect() on an object that was not a sprite asset. (' + unparse(CC) + ')');
    }

    let z_order = z, z_pos = corner.z;
    if (z_order === undefined) { z_order = z_pos || 0; }
    if (z_pos === undefined) { z_pos = z_order; }
    z_pos -= $camera.z;
    // Not used after here
    //z_order -= $camera.z;
    
    const skx = (z_pos * $skewXZ), sky = (z_pos * $skewYZ);
    let x1 = (corner.x + skx) * $scaleX + $offsetX, y1 = (corner.y + sky) * $scaleY + $offsetY;
    let x2 = (corner.x + size.x + skx) * $scaleX + $offsetX, y2 = (corner.y + size.y + sky) * $scaleY + $offsetY;

    // Not used after here
    //z_pos = z_pos * $scaleZ + $offsetZ;
    //z_order = z_order * $scaleZ + $offsetZ;

    // Sort coordinates
    let t1 = $Math.min(x1, x2), t2 = $Math.max(x1, x2);
    x1 = t1; x2 = t2;
    
    t1 = $Math.min(y1, y2), t2 = $Math.max(y1, y2);
    y1 = t1; y2 = t2;

    // Lock to the pixel grid before computing offsets
    x1 = $Math.round(x1); y1 = $Math.round(y1);
    x2 = $Math.floor(x2 - 0.5); y2 = $Math.floor(y2 - 0.5);
    
    const centerX = (x2 + x1) / 2, centerY = (y2 + y1) / 2;

    // We always put a tile in the center, so the width is based on
    // the ceiling of the *half* width, not the full width. Note the
    // the number of tiles in each direction is therefore guaranteed
    // to be odd.
    const numTilesX = 1 + $Math.ceil((x2 - x1 + 1) / (2 * CC.size.x) - 0.49) * 2;
    const numTilesY = 1 + $Math.ceil((y2 - y1 + 1) / (2 * CC.size.y) - 0.49) * 2;
    
    // Iterate over center box, clipping at its edges
    const spriteCenter = {x:0, y:0, z:corner.z};
    $pushGraphicsState(); {
        intersect_clip(xy(x1, y1), xy(x2 - x1 + 1, y2 - y1 + 1));
        
        for (let y = 0; y < numTilesY; ++y) {
            // Transform individual pixel coordinates *back* to game
            // coords for the draw_sprite call to handle clipping and
            // insertion into the queue.
            spriteCenter.y = ((centerY + (y - (numTilesY - 1) * 0.5) * CC.size.y) - $offsetY) / $scaleY;
            for (let x = 0; x < numTilesX; ++x) {
                spriteCenter.x = ((centerX + (x - (numTilesX - 1) * 0.5) * CC.size.x) - $offsetX) / $scaleX;
                draw_sprite(CC, spriteCenter, 0, undefined, 1, z);
            }
        }
    } $popGraphicsState();
    
    // Generate relative sprites
    const LT = CC.$spritesheet[$Math.max(0, CC.$tileX - 1)][$Math.max(0, CC.$tileY - 1)];
    const CT = CC.$spritesheet[$Math.max(0, CC.$tileX    )][$Math.max(0, CC.$tileY - 1)];
    const RT = CC.$spritesheet[$Math.max(0, CC.$tileX + 1)][$Math.max(0, CC.$tileY - 1)];

    const LC = CC.$spritesheet[$Math.max(0, CC.$tileX - 1)][$Math.max(0, CC.$tileY    )];
    const RC = CC.$spritesheet[$Math.max(0, CC.$tileX + 1)][$Math.max(0, CC.$tileY    )];

    const LB = CC.$spritesheet[$Math.max(0, CC.$tileX - 1)][$Math.max(0, CC.$tileY + 1)];
    const CB = CC.$spritesheet[$Math.max(0, CC.$tileX    )][$Math.max(0, CC.$tileY + 1)];
    const RB = CC.$spritesheet[$Math.max(0, CC.$tileX + 1)][$Math.max(0, CC.$tileY + 1)];

    // Centers of the sprites on these edges
    const left   = ((x1 - CC.size.x * 0.5) - $offsetX) / $scaleX - 0.5;
    const right  = ((x2 + CC.size.x * 0.5) - $offsetX) / $scaleX + 1;
    const top    = ((y1 - CC.size.y * 0.5) - $offsetY) / $scaleY - 0.5;
    const bottom = ((y2 + CC.size.y * 0.5) - $offsetY) / $scaleY + 1;
    
    // Top and bottom
    $pushGraphicsState(); {
        intersect_clip(xy(x1, $clipY1), xy(x2 - x1 + 1, $clipY2 - $clipY1 + 1));
        
        for (let x = 0; x < numTilesX; ++x) {
            spriteCenter.x = ((centerX + (x - (numTilesX - 1) * 0.5) * CC.size.x) - $offsetX) / $scaleX;

            spriteCenter.y = top;
            draw_sprite(CT, spriteCenter, 0, undefined, 1, z);
            
            spriteCenter.y = bottom;
            draw_sprite(CB, spriteCenter, 0, undefined, 1, z);
        }
    } $popGraphicsState();

    // Sides
    $pushGraphicsState(); {
        intersect_clip(xy($clipX1, y1), xy($clipX2 - $clipX1 + 1, y2 - y1 + 1));
        
        for (let y = 0; y < numTilesY; ++y) {
            spriteCenter.y = ((centerY + (y - (numTilesY - 1) * 0.5) * CC.size.y) - $offsetY) / $scaleY;

            spriteCenter.x = left;
            draw_sprite(LC, spriteCenter, 0, undefined, 1, z);
            
            spriteCenter.x = right;
            draw_sprite(RC, spriteCenter, 0, undefined, 1, z);
        }
    } $popGraphicsState();

    // Corners (no new clipping needed)
    {
        // Left Top
        spriteCenter.x = left; spriteCenter.y = top;
        draw_sprite(LT, spriteCenter, 0, undefined, 1, z);
        
        // Right Top
        spriteCenter.x = right;
        draw_sprite(RT, spriteCenter, 0, undefined, 1, z);

        // Left Bottom
        spriteCenter.x = left; spriteCenter.y = bottom;
        draw_sprite(LB, spriteCenter, 0, undefined, 1, z);

        // Right Bottom
        spriteCenter.x = right;
        draw_sprite(RB, spriteCenter, 0, undefined, 1, z);
    }
}


// Returns the original pos, or a new object that is transformed by
// angle, scale, and the current drawing options if pivot is nonzero.
function $maybeApplyPivot(pos, pivot, angle, scale) {
    if (! pivot || (pivot.x === 0 && pivot.y === 0)) {
        return pos;
    }

    let scaleX = 1, scaleY = 1;
    if (scale) {
        if (is_number(scale)) {
            scaleX = scaleY = scale;
        } else {
            scaleX = scale.x;
            scaleY = scale.y;
        }
    }

    if (angle === undefined) { angle = 0; }
    
    // Raw sprite offset
    // Scale into sprite space
    let deltaX = pivot.x * $Math.sign($scaleX) * scaleX;
    let deltaY = pivot.y * $Math.sign($scaleY) * scaleY;
    
    // Rotate into sprite space
    const C = $Math.cos(angle);
    const S = $Math.sin(angle) * -rotation_sign();
    return {x: pos.x - (deltaX * C + S * deltaY),
            y: pos.y - (deltaY * C - S * deltaX),
            z: pos.z};
}


function draw_sprite(spr, pos, angle, scale, opacity, z, override_color, override_blend, pivot) {
    if ($skipGraphics) { return; }

    if (spr && spr.pos && ! spr.sprite) { $error('sprite must not be nil for draw_sprite()'); }
    
    if (spr && spr.sprite) {
        // This is the "keyword" version of the function
        z = spr.z;
        opacity = spr.opacity;
        scale = spr.scale;
        angle = spr.angle;
        pos = spr.pos;
        override_color = spr.override_color;
        override_blend = spr.override_blend;
        pivot = spr.pivot;
        spr = spr.sprite;
    }

    if (! pos) { $error("pos must not be nil for draw_sprite()"); }

    const multiply = override_blend === 'multiply';

    if (opacity <= 0) { return; }

    if (Array.isArray(spr) && spr.sprite_size && Array.isArray(spr[0])) {
        // The sprite was a spritesheet. Grab the first element
        spr = spr[0][0];
    }

    if (! (spr && spr.$spritesheet && spr.$type === 'sprite')) {
        $error('Called draw_sprite() on an object that was not a sprite asset. (' + unparse(spr) + ')');
    }
    
    let z_order = z, z_pos = pos.z;
    if (z_order === undefined) { z_order = z_pos || 0; }
    if (z_pos === undefined) { z_pos = z_order; }
    z_pos -= $camera.z;
    z_order -= $camera.z;

    angle = angle || 0;

    pivot = pivot || spr.pivot;
    pos = $maybeApplyPivot(pos, pivot, angle, scale);

    if (($camera.x !== 0) || ($camera.y !== 0) || ($camera.angle !== 0) || ($camera.zoom !== 1)) {
        // Transform the arguments to account for the camera
        const mag = $zoom(z_pos);
        const C = $Math.cos($camera.angle) * mag, S = $Math.sin($camera.angle * rotation_sign()) * mag;
        const x = pos.x - $camera.x, y = pos.y - $camera.y;
        pos = {x: x * C + y * S, y: y * C - x * S};
        angle -= $camera.angle;

        switch (typeof scale) {
        case 'number': scale = {x: scale, y: scale}; break;
        case 'undefined': scale = {x: 1, y: 1}; break;
        }
        scale = {x: scale.x * mag, y: scale.y * mag};
    }
    
    const skx = z_pos * $skewXZ, sky = z_pos * $skewYZ;
    const x = (pos.x + skx) * $scaleX + $offsetX;
    const y = (pos.y + sky) * $scaleY + $offsetY;
    z_pos = z_pos * $scaleZ + $offsetZ;
    z_order = z_order * $scaleZ + $offsetZ;

    let scaleX = 1, scaleY = 1;
    if ((scale !== 0) && (typeof scale === 'number')) {
        scaleX = scaleY = scale;
    } else if (scale && scale.x && scale.y) {
        scaleX = scale.x;
        scaleY = scale.y;
    }
    
    // Apply the sprite's own flipping
    scaleX *= spr.scale.x; scaleY *= spr.scale.y;
    
    opacity = $Math.max(0, $Math.min(1, (opacity === undefined) ? 1 : opacity));
    const radius = spr.$boundingRadius * $Math.max($Math.abs(scaleX), $Math.abs(scaleY));

    if ((opacity <= 0) || (x + radius < $clipX1 - 0.5) || (y + radius < $clipY1 - 0.5) ||
        (x >= $clipX2 + radius + 0.5) || (y >= $clipY2 + radius + 0.5) ||
        (z_pos < $clipZ1 - 0.5) || (z_pos >= $clipZ2 + 0.5)) {
        return;
    }

    // Don't use rotation_sign() on the angle, because the angle
    // WILL be interpreted as CCW when the queued command actually
    // executes.

    if (override_color) {
        // have to clone and convert to RGB space
        override_color = rgba(override_color);
    }

    const sprElt = {
        spritesheetIndex:  spr.$spritesheet.$index[0],
        cornerX:       spr.$x,
        cornerY:       spr.$y,
        sizeX:         spr.size.x,
        sizeY:         spr.size.y,
        
        angle:         (angle || 0),
        scaleX:        scaleX,
        scaleY:        scaleY,
        hasAlpha:      spr.$hasAlpha,
        opacity:       opacity,
        override_color: override_color ? $colorToUint16(override_color) : 0,
        multiply:      multiply,
        x:             x,
        y:             y
    };

    $console.assert(sprElt.spritesheetIndex >= 0 &&
                    spr.$name + ' has a bad index: ' + sprElt.spritesheetIndex);
    // Aggregate multiple sprite calls
    const prevCommand = $graphicsCommandList[$graphicsCommandList.length - 1];
    if (prevCommand && (prevCommand.baseZ === z_order) &&
        (prevCommand.opcode === 'SPR') &&
        (prevCommand.clipX1 === $clipX1) && (prevCommand.clipX2 === $clipX2) &&
        (prevCommand.clipY1 === $clipY1) && (prevCommand.clipY2 === $clipY2)) {
        // Modify the existing command to reduce sorting demands for scenes
        // with a large number of sprites
        prevCommand.data.push(sprElt);
    } else {
        $addGraphicsCommand({
            opcode:       'SPR',
            // Comparison z for detecting runs of sprites
            baseZ:         z_order,

            // Sorting Z
            z:             z_order,
            data: [sprElt]});
    }
}


// Can't be implemented as min(loop(x,k), k - loop(x,k)) because
// that doesn't handle fractional values in the desired way.
function oscillate(x, lo, hi) {
    if (lo === undefined) {
        lo = 0; hi = 1;
    } else if (hi === undefined) {
        // Legacy version
        hi = lo;
        lo = 0;
    }

    if (hi <= lo) { $error("oscillate(x, lo, hi) must have hi > lo"); }
    x -= lo;
    hi -= lo;
    
    const k = 2 * hi;
    x = loop(x, k);
    return ((x < hi) ? x : k - x) + lo;
}


function clamp(x, lo, hi) {
    // Test for all three being Numbers, which have a toFixed method
    if (x.toFixed && lo.toFixed && hi.toFixed) {
        return x < lo ? lo : x > hi ? hi : x;
    } else {
        return min(max(x, lo), hi);
    }
}

// On numbers only
function $loop(x, lo, hi) {
    x -= lo;
    hi -= lo;
    return (x - $Math.floor(x / hi) * hi) + lo;
}

function loop(x, lo, hi) {
    if (typeof x === 'object') {
        // Vector version
        const c = x.constructor ? x.constructor() : Object.create(null);

        if (typeof lo === 'object') {
            if (typeof hi === 'object') {
                for (let key in x) { c[key] = loop(x[key], lo[key], hi[key]); }
            } else {
                for (let key in x) { c[key] = loop(x[key], lo[key], hi); }
            }
        } else if (typeof hi === 'object') {
            for (let key in x) { c[key] = loop(x[key], lo, hi[key]); }
        } else {
            for (let key in x) { c[key] = loop(x[key], lo, hi); }
        }
        
        return c;
    }

    
    if (hi === undefined) {
        hi = lo;
        lo = 0;
    }

    if (hi === undefined) { hi = 1; }

    return $loop(x, lo, hi);
}


function get_background() {
    return $background;
}


function set_background(c) {
    if (Array.isArray(c) && c.sprite_size && Array.isArray(c[0])) {
        // c was a sprite sheet
        c = c[0][0];
    }

    if (c.$spritesheet && (c.$spritesheet.size.x !== $SCREEN_WIDTH || c.$spritesheet.size.y !== $SCREEN_HEIGHT ||
                           c.size.x !== $SCREEN_WIDTH || c.size.y !== $SCREEN_HEIGHT)) {
        $error('The sprite and its spritesheet for set_background() must be exactly the screen size.')
    }
    
    $background = c;
}


// Transform v into the reference frame of entity
function $toFrame(entity, v, out) {
    // Translate
    const x = v.x - entity.pos.x;
    const y = v.y - entity.pos.y;
    
    // Rotate
    let c = $Math.cos(entity.angle * rotation_sign());
    let s = $Math.sin(entity.angle * rotation_sign());
    
    if (out === undefined) { out = {x:0, y:0}; }
    
    out.x = x * c + y * s;
    out.y = y * c - x * s;
    
    return out;
}


function draw_bounds(entity, color, recurse) {
    if ($skipGraphics) { return; }
    
    if (! entity.pos) {
        $error('draw_bounds() must be called on an object with at least a pos property');
    }
    
    if (recurse === undefined) { recurse = true; }
    color = color || {r: 0.6, g: 0.6, b: 0.6};
    const angle = (entity.angle || 0) * rotation_sign();
    const scale = entity.scale || {x: 1, y: 1};

    let pos = $maybeApplyPivot(entity.pos, entity.pivot, entity.angle, scale);
    
    
    // Bounds:
    const z_order = entity.z + 0.01;
    if ((entity.shape === 'disk') && entity.size) {
        draw_disk(pos, entity.size.x * 0.5 * scale.x, undefined, color, z_order)
    } else if (entity.shape === 'rect' && entity.size) {
        const u = {x: $Math.cos(angle) * 0.5, y: $Math.sin(angle) * 0.5};
        const v = {x: -u.y, y: u.x};
        u.x *= entity.size.x * scale.x; u.y *= entity.size.x * scale.x;
        v.x *= entity.size.y * scale.y; v.y *= entity.size.y * scale.y;

        const A = {x: pos.x - u.x - v.x, y: pos.y - u.y - v.y, z: entity.pos.z};
        const B = {x: pos.x + u.x - v.x, y: pos.y + u.y - v.y, z: entity.pos.z};
        const C = {x: pos.x + u.x + v.x, y: pos.y + u.y + v.y, z: entity.pos.z};
        const D = {x: pos.x - u.x + v.x, y: pos.y - u.y + v.y, z: entity.pos.z};
        draw_line(A, B, color, z_order);
        draw_line(B, C, color, z_order);
        draw_line(C, D, color, z_order);
        draw_line(D, A, color, z_order);
    } else if (is_array(entity.shape) && entity.size) {
        draw_poly(entity.shape, undefined, color, entity.pos, entity.angle, scale, z_order);
    } else {
        draw_point(pos, color, z_order);
    }

    // Axes
    {
        const u = {x: $Math.cos(angle) * 16, y: $Math.sin(angle) * 16};
        const v = {x: -u.y, y: u.x};
        u.x *= scale.x; u.y *= scale.x;
        v.x *= scale.y; v.y *= scale.y;

        // Do not apply the pivot to the axes
        const B = {x: entity.pos.x + u.x, y: entity.pos.y + u.y, z: entity.pos.z};
        const C = {x: entity.pos.x + v.x, y: entity.pos.y + v.y, z: entity.pos.z};
        
        draw_line(entity.pos, B, {r:1, g:0, b:0}, z_order);
        draw_line(entity.pos, C, {r:0, g:1, b:0}, z_order);
    }

    if (entity.child_array && recurse) {
        for (let i = 0; i < entity.child_array; ++i) {
            debugDrawEntity(entity.child_array[c], color, recurse);
        }
    }
}


function $getAABB(e, aabb) {
    // Take the bounds to draw space
    let w = (e.scale ? e.scale.x : 1) * e.size.x;
    let h = (e.scale ? e.scale.y : 1) * e.size.y;
    if ((e.shape !== 'disk') && (e.angle !== undefined)) {
        const c = $Math.abs($Math.cos(e.angle));
        const s = $Math.abs($Math.sin(e.angle));
        const x = w * c + h * s;
        const y = h * c + w * s;
        w = x; h = y;
    }
    w *= 0.5;
    h *= 0.5;
    aabb.max.x = $Math.max(aabb.max.x, e.pos.x + w);
    aabb.min.x = $Math.min(aabb.min.x, e.pos.x - w);
    aabb.max.y = $Math.max(aabb.max.y, e.pos.y + h);
    aabb.min.y = $Math.min(aabb.min.y, e.pos.x - h);

    // Recurse
    if (e.child_array) {
        for (let i = 0; i < e.child_array.length; ++i) {
            $getAABB(e.child_array[i], aabb);
        }
    }
}


function axis_aligned_draw_box(e) {
    const aabb = {max: xy(-Infinity, -Infinity),
                  min: xy( Infinity,  Infinity)};
    $getAABB(e, aabb);
    return {pos: xy((aabb.max.x + aabb.min.x) * 0.5,
                    (aabb.max.y + aabb.min.y) * 0.5),
            shape: 'rect',
            scale: xy(1, 1),
            angle: 0,
            size: xy(aabb.max.x - aabb.min.x,
                     aabb.max.y - aabb.min.y)};            
}


/** All arguments except the ray are xy(). Clones only the
    ray. Assumes that (0, 0) is the grid origin */
function $makeRayGridIterator(rayPos, rayDir, rayLength, numCells, cellSize) {

    const it = {
        numCells:          numCells,
        enterDistance:     0,

        // Will be set to 'x' or 'y' by advancing the iterator
        enterAxis:         '',
        
        ray:               {pos: {x: rayPos.x, y: rayPos.y},
                            dir: {x: rayDir.x, y: rayDir.y},
                            length: rayLength},
        
        cellSize:          cellSize,

        // Is the iterator's current point still inside the grid
        insideGrid:        true,

        // Does the current cell contain the ray origin (if not
        // then it is on an edge)
        containsRayOrigin: true,
        index:             {x:0, y:0},
        tDelta:            {x:0, y:0},
        step:              {x:0, y:0},
        exitDistance:      {x:0, y:0},
        boundaryIndex:     {x:0, y:0}
    };

    //////////////////////////////////////////////////////////////////////
    // See if the ray begins inside the grid

    let startsOutside = false;
    let startLocation = {x: it.ray.pos.x, y: it.ray.pos.y};
    let inside = startLocation.x >= 0 && startLocation.x < numCells.y * cellSize.x &&
        startLocation.y >= 0 && startLocation.y < numCells.y * cellSize.y;
    
    ///////////////////////////////

    if (! inside) {
        // The ray is starting outside of the grid. See if it ever
        // intersects the grid.
        
        // From Listing 1 of "A Ray-Box Intersection Algorithm and Efficient Dynamic Voxel Rendering", jcgt 2018
        const t0 = {x: -it.ray.pos.x / it.ray.dir.x,
                    y: -it.ray.pos.y / it.ray.dir.y};
        const t1 = {x: (numCells.x * cellSize.x - it.ray.pos.x) / it.ray.dir.x,
                    y: (numCells.y * cellSize.y - it.ray.pos.y) / it.ray.dir.y};
        const tmin = {x: $Math.min(t0.x, t1.x),
                      y: $Math.min(t0.y, t1.y)};
        const tmax = {x: $Math.max(t0.x, t1.x),
                      y: $Math.max(t0.y, t1.y)};
        
        const passesThroughGrid = $Math.max(tmin.x, tmin.y) <= $Math.min(tmax.x, tmax.y);
        
        if (passesThroughGrid) {
            // Back up slightly so that we immediately hit the start location
            it.enterDistance = $Math.hypot(it.ray.pos.x - startLocation.x,
                                           it.ray.pos.y - startLocation.y) - 0.00001;
            startLocation = {x: it.ray.pos.x + it.ray.dir.x * it.enterDistance,
                             y: it.ray.pos.y + it.ray.dir.y * it.enterDistance};
            startsOutside = true;
        } else {
            // The ray never hits the grid
            it.insideGrid = false;
        }
    }

    //////////////////////////////////////////////////////////////////////
    // Find the per-iteration variables
    const axisArray = 'xy';
        
    for (let i = 0; i < 2; ++i) {
        const a = axisArray[i];
        
        it.index[a]  = $Math.floor(startLocation[a] / cellSize[a]);
        it.tDelta[a] = $Math.abs(cellSize[a] / it.ray.dir[a]);
        it.step[a]   = $Math.sign(it.ray.dir[a]);

        // Distance to the edge of the cell along the ray direction
        let d = startLocation[a] - it.index[a] * cellSize[a];
        if (it.step[a] > 0) {
            // Measure from the other edge
            d = cellSize[a] - d;

            // Exit on the high side
            it.boundaryIndex[a] = it.numCells[a];
        } else {
            // Exit on the low side (or never)
            it.boundaryIndex[a] = -1;
        }
        $console.assert(d >= 0 && d <= cellSize[a]);

        if (it.ray.dir[a] !== 0) {
            it.exitDistance[a] = d / $Math.abs(it.ray.dir[a]) + it.enterDistance;
        } else {
            // Ray is parallel to this partition axis.
            // Avoid dividing by zero, which could be NaN if d === 0
            it.exitDistance[a] = Infinity;
        }
    }

    if (startsOutside) {
        // Let the increment operator bring us into the first cell
        // so that the starting axis is initialized correctly.
        $advanceRayGridIterator(it);
    }

    return it;
}


function $advanceRayGridIterator(it) {
    // Find the axis of the closest partition along the ray
    it.enterAxis = (it.exitDistance.x < it.exitDistance.y) ? 'x' : 'y';

    $console.assert(it.exitDistance[it.enterAxis] < Infinity);
    
    it.enterDistance               = it.exitDistance[it.enterAxis];
    it.index[it.enterAxis]        += it.step[it.enterAxis];
    it.exitDistance[it.enterAxis] += it.tDelta[it.enterAxis];
    
    // If the index just hit the boundary exit, we have
    // permanently exited the grid.
    it.insideGrid = it.insideGrid && (it.index[it.enterAxis] !== it.boundaryIndex[it.enterAxis]);
    
    it.containsRayOrigin = false;
}


function $default_ray_map_pixel_callback(sprite, sprite_pixel_coord, ws_normal, ray, map, distance, ws_coord, map_coord) {
    // Inlined optimization of: if (sprite_pixel_color(sprite, sprite_pixel_coord).a >= 0.5) {
    const x = ((sprite.scale.x > 0) ? sprite_pixel_coord.x : (sprite.size.x - 1 - sprite_pixel_coord.x)) | 0;
    const y = ((sprite.scale.y > 0) ? sprite_pixel_coord.y : (sprite.size.y - 1 - sprite_pixel_coord.y)) | 0;
    const data = sprite.$spritesheet.$uint16Data;
    const pixel = data[((sprite.$x >>> 0) + x) + ((sprite.$y >>> 0) + y) * (data.width >>> 0)] >>> 0;

    if (((pixel >>> 12) & 0xf) >= 8) {
        return sprite;
    } else {
        return undefined;
    }
}


function ray_intersect_map(ray, map, layer, sprite_callback, pixel_callback, replacement_array, run_callback_on_empty_sprites) {
    if (sprite_callback === undefined && pixel_callback === undefined) {
        pixel_callback = $default_ray_map_pixel_callback;
    }

    layer = layer || 0;
    if (layer < 0 || layer >= map.layer.length) {
        $error('ray_intersect_map() requires the layer to be specified and in bounds for the map');
    }
    
    // Default to an infinite ray
    if (ray.length === undefined) {
        ray.length = Infinity;
    }

    // Normalize the direction
    {
        const inv = 1 / $Math.hypot(ray.dir.x, ray.dir.y);
        ray.dir.x *= inv; ray.dir.y *= inv;
    }

    // Will be mutated below
    const pixel_ray = {
        pos: xy(0, 0),
        dir: ray.dir,
        length: 0};

    // Will be mutated below
    const ws_normal = xy(0, 0);
    const map_coord = xy(0, 0);
    const ps_coord = xy(0, 0);
    const ws_coord = xy(0, 0);

    const inv_sprite_size_x = 1 / map.sprite_size.x;
    const inv_sprite_size_y = 1 / map.sprite_size.y;

    const one = xy(1, 1);
    const inf = xy(Infinity, Infinity);

    // Take the ray into map pixel space by offsetting the origin
    const map_pixel_start = xy(ray.pos.x - map.offset.x, ray.pos.y - map.offset.y);

    // The iterator copies the position and direction
    for (const it = $makeRayGridIterator(map_pixel_start, ray.dir, ray.length, map.size, map.sprite_size);
         it.insideGrid && (it.enterDistance < it.ray.length);
         $advanceRayGridIterator(it)) {
        
        // World-space normal along which we entered this cell
        ws_normal.x = ws_normal.y = 0;
        ws_normal[it.enterAxis] = -it.step[it.enterAxis];

        // World-space point at which we entered the cell. Note that
        // this is based on the original world-space ray, not the iterator's
        // map-pixel space ray.
        ws_coord.x = ray.pos.x + it.enterDistance * it.ray.dir.x;
        ws_coord.y = ray.pos.y + it.enterDistance * it.ray.dir.y;

        // Bump into the cell and then round down to get a map cell
        // coordinate.
        map_coord.x = $Math.floor((ws_coord.x - ws_normal.x * 0.5 - map.offset.x) * inv_sprite_size_x);
        map_coord.y = $Math.floor((ws_coord.y - ws_normal.y * 0.5 - map.offset.y) * inv_sprite_size_y);

        // Get the sprite
        const sprite = get_map_sprite(map, map_coord, layer, replacement_array);
        
        if (sprite || run_callback_on_empty_sprites) {
            $ws_coord_to_map_sprite_coord(map, ws_coord, layer, ps_coord);
            
            if (sprite_callback) {
                const result = sprite_callback(sprite, ps_coord, ws_normal, it.ray, map, it.enterDistance, ws_coord, map_coord);
                if (result !== undefined) {
                    // Shorten ray
                    ray.length = $distanceSquared2D(ws_coord, ray.pos);
                    return result;
                }
            }

            if (sprite && pixel_callback) {

                pixel_ray.pos.x = ws_coord.x; pixel_ray.pos.y = ws_coord.y;
                pixel_ray.length = $Math.min(it.exitDistance.x, it.exitDistance.y) - it.enterDistance;

                for (const pit = $makeRayGridIterator(pixel_ray.pos, pixel_ray.dir, pixel_ray.length, inf, one);
                     pit.insideGrid && (pit.enterDistance < pit.ray.length);
                     $advanceRayGridIterator(pit)) {

                    // World-space normal along which we entered this pixel
                    ws_normal.x = ws_normal.y = 0;
                    ws_normal[it.enterAxis] = -pit.step[it.enterAxis];

                    // World-space point at which we entered the pixel
                    ws_coord.x = pit.ray.pos.x + pit.enterDistance * pit.ray.dir.x;
                    ws_coord.y = pit.ray.pos.y + pit.enterDistance * pit.ray.dir.y;

                    $ws_coord_to_map_sprite_coord(map, ws_coord, layer, ps_coord);

                    const result = pixel_callback(sprite, ps_coord, ws_normal, it.ray, map, it.enterDistance, ws_coord, map_coord);
                    if (result !== undefined) {
                        // Shorten ray
                        ray.length = pit.enterDistance + it.enterDistance;
                        return result;
                    }
                } // For each pixel
            }
        } // if sprite
        
    }  // while

    return undefined;
}


/* Returns true if (px, py) is inside of the convex polygon defined by the
 array of 2D vertices. Does not assume a winding direction for the polygon. */
function $point_in_poly(px, py, vertex) {
    // Using the winding number algorithm for convex polygons
    let prevSign = 0;

    for (let i = 0; i < vertex.length; ++i) {
        // Current vertex (scaled)
        const ix = vertex[i].x;
        const iy = vertex[i].y;

        // Next vertex (wrap around)
        const j = (i + 1) % vertex.length;

        // Edge vector
        const edgeDX = vertex[j].x - ix;
        const edgeDY = vertex[j].y - iy;

        // Vector from current vertex to point
        const dx = px - ix;
        const dy = py - iy;

        // Determine the sign of the cross product
        const currSign = Math.sign(edgeDX * dy - edgeDY * dx);

        // Initialize sign on first iteration
        if ((prevSign === 0) && (currSign !== 0)) {
            prevSign = currSign;
        }

        // If the sign changes, then the point is outside the polygon
        if ((currSign !== 0) && (currSign !== prevSign)) {
            return false;
        }
    }

    // The point is inside the polygon as it was on the same side of 
    // all convex lines
    return true;
}


function $ray_intersect_poly(originX, originY, directionX, directionY, vertex, scaleX, scaleY) {
    // Check if the origin is inside the polygon
    if ($point_in_poly(originX / scaleX, originY / scaleY, vertex)) {
        // Origin is inside the polygon; return distance 0
        return 0;
    }

    // Initialize minimum distance to Infinity
    let minDistance = Infinity;

    // Iterate over each edge of the polygon
    for (let i = 0; i < vertex.length; ++i) {
        // Current vertex (scaled)
        const ix = vertices[i].x * scaleX;
        const iy = vertices[i].y * scaleY;

        // Next vertex (wrap around using modulo)
        j = (i + 1) % vertexCount;
        const jx = vertices[j].x * scaleX;
        const jy = vertices[j].y * scaleY;

        // Edge vector (from i to j)
        const edgeDX = jx - ix;
        const edgeDY = jy - iy;

        // Compute the denominator of the parametric equations
        const denominator = directionX * edgeDY - directionY * edgeDX;

        // Avoid division by very small values to maintain numerical stability
        if (Math.abs(denominator) < 1e-14) {
            // Ray and edge are parallel; skip this edge
            continue;
        }

        // Compute the parameters along the ray (t) and along the edge (u)
        const dx = ix - originX;
        const dy = iy - originY;

        const t = (edgeDX * dy - edgeDY * dx) / denominator;
        const u = (directionX * dy - directionY * dx) / denominator;

        // t: time to intersection along the ray
        // u: position along this edge of the intersection (from 0 to 1)

        // Check if intersection occurs along the positive ray direction and on the edge segment
        if ((t >= 0) && (u >= 0) && (u <= 1) && (t < minDistance)) {
            minDistance = t;
        }
    }

    // Return the minimum distance found, or Infinity if no intersection
    return minDistance;
}



function ray_intersect(ray, obj) {
    let hitObj = undefined;
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; ++i) {
            hitObj = ray_intersect(ray, obj[i]) || hitObj;
        }
        return hitObj;
    }

    // Default to an infinite ray
    if (ray.length === undefined) {
        ray.length = Infinity;
    }

    const scaleX = obj.scale ? obj.scale.x : 1;
    const scaleY = obj.scale ? obj.scale.y : 1;

    const pos = $maybeApplyPivot(obj.pos, obj.pivot, obj.angle, obj.scale);
    
    if (obj.size) {
        // Normalize the direction
        let inv = 1 / $Math.hypot(ray.dir.x, ray.dir.y);
        ray.dir.x *= inv; ray.dir.y *= inv;
        
        if (obj.shape === 'disk') {
            // ray-disk (https://www.geometrictools.com/Documentation/IntersectionLine2Circle2.pdf)
            let dx = ray.pos.x - pos.x, dy = ray.pos.y - pos.y;
            if (dx * dx + dy * dy * 4 <= $Math.abs(obj.size.x * obj.size.y * scaleX * scaleY)) {
                // Origin is inside the disk, so instant hit and no need
                // to look at children
                ray.length = 0;
                return obj;
            } else {
                // Origin is outside of the disk.
                const b = ray.dir.x * dx + ray.dir.y * dy
                const discrim = b*b - (dx*dx + dy*dy - 0.25 * obj.size.x * obj.size.y * scaleX * scaleY);
                if (discrim >= 0) {
                    const a = $Math.sqrt(discrim);
                    
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
            let toriginX = ray.pos.x - pos.x;
            let toriginY = ray.pos.y - pos.y;
            
            // Take the ray into the box's rotational frame
            const angle = (obj.angle || 0) * rotation_sign();
            const c = $Math.cos(angle), s = $Math.sin(angle);

            const originX = toriginX * c + toriginY * s;
            const originY =-toriginX * s + toriginY * c;

            const directionX = ray.dir.x * c + ray.dir.y * s;
            const directionY =-ray.dir.x * s + ray.dir.y * c;

            const radX = obj.size.x * 0.5 * scaleX;
            const radY = obj.size.y * 0.5 * scaleY;

            // Perform ray vs. oriented box intersection
            // (http://jcgt.org/published/0007/03/04/)

            const winding = ($Math.max(abs(originX / radX),
                                      abs(originY / radY)) < 1.0) ? -1 : 1;

            const sgnX = -$Math.sign(directionX);
            const sgnY = -$Math.sign(directionY);
            
            // Distance to edge lines
            const dX = (radX * winding * sgnX - originX) / directionX;
            const dY = (radY * winding * sgnY - originY) / directionY;

            const testX = (dX >= 0) && ($Math.abs(originY + directionY * dX) < radY);
            const testY = (dY >= 0) && ($Math.abs(originX + directionX * dY) < radX);

            if (obj.shape === 'rect') {
                if (testX) {
                    if (dX < ray.length) {
                        // Shorten the ray to the hit point
                        ray.length = dX;
                        hitObj = obj;
                    }
                } else if (testY && (dY < ray.length)) {
                    // Shorten the ray to the hit point
                    ray.length = dY;
                    hitObj = obj;
                }
            } else { // Polygon
                if (! is_array(obj.shape)) { $error('Entity/region shape must be disk, rect, or a polygon'); }
                
                if ((testX && (dX < ray.length)) ||
                    (! testX && (testY && (dY < ray.length)))) {
                    // The ray conservatively hits the bounding box. Now test the
                    // actual polygon for an intersection.
                    //
                    // We have ray with origin (originX, originY) in direction
                    // (directionX, directionY) that has been rotated and translated
                    // into the polygon's space but NOT scaled. The ray direction is not
                    // a unit vector. The ray origin may already be inside the polygon.
                    // We are testing for intersection against convex polygon obj.shape, 
                    // where each vertex of the polygon must be scaled by (scaleX, scaleY). 

                    const hitPolyTime = $ray_intersect_poly(originX, originY, directionX, directionY, obj.shape, scaleX, scaleY);
                    if (hitPolyTime < ray.length) {
                        // shorten the ray to the hit
                        ray.length = hitPolyTime;
                        hitObj = obj;
                    }

                } // bounding box
            } 
        }
    }

    // Test children
    if (obj.child_array) {
        hitObj = ray_intersect(ray, obj.child_array) || hitObj;
    }

    return hitObj;
}


function entity_projected_length(entity, vector, recurse = true) {
    let result = 0;
    
    if (recurse && entity.child_array && entity.child_array.length > 0) {
        for (let child of entity.child_array) {
            result += entity_projected_length(child, vector);
        }
    }

    // Transform the vector into the rotational frame of the entity
    const C = $Math.cos(entity.angle);
    const S = $Math.sin(entity.angle) * -rotation_sign();
    vector = {x: C * vector.x + S * vector.y, y: C * vector.y - S * vector.x};

    const scaleX = entity.scale !== undefined ? entity.scale.x : 1;
    const scaleY = entity.scale !== undefined ? entity.scale.y : 1;
    
    if (entity.size === undefined) {
        // Do nothing
        
    } else if (entity.shape === 'disk') {
        // Projected length of a disk is the diameter
        result += $Math.abs(scaleX * entity.size.x);
    } else if (entity.shape === 'rect') {
        // Project each edge
        result += $Math.abs(scaleX * entity.size.x * vector.x) + $Math.abs(scaleY * entity.size.x * vector.y);
    } else if (is_array(entity.shape)) {
        // Project each front face (or back face, it doesn't
        // matter). It would be more efficient to take the vector into
        // the scaled entity frame, but this implementation is easier
        // to maintain because it is more straightforward.

        const poly = entity.shape;
        let prevX = scaleX * poly[poly.length - 1].x;
        let prevY = scaleY * poly[poly.length - 1].y;
        console.log('---------------------------');
        for (let i = 0; i < poly.length; ++i) {
            const curr = poly[i];
            const currX = scaleX * curr.x;
            const currY = scaleY * curr.y;

            const edgeX = currX - prevX;
            const edgeY = currY - prevY;

            console.log(edgeX, edgeY, $Math.max(edgeX * vector.x + edgeY * vector.y, 0));
            // edge dot perp(vector). Only consider the positive
            // projected lengths; half of the projected length will be
            // on the negative side
            result += $Math.max(edgeX * vector.x + edgeY * vector.y, 0);

            prevX = currX;
            prevY = currY;
        }
            
    } else {
        $error('Unsupported shape: "' + shape + '"');
    }

    return result;   
}

 
function entity_area(entity, recurse = true) {
    let area = 0;
    
    if (recurse && entity.child_array && entity.child_array.length > 0) {
        for (let child of entity.child_array) {
            area += entity_area(child);
        }
    }

    const scaleX = entity.scale !== undefined ? entity.scale.x : 1;
    const scaleY = entity.scale !== undefined ? entity.scale.y : 1;

    if (entity.size === undefined) {
        return area;
    } else if (entity.shape === 'disk') {
        return area + $Math.abs($Math.PI * 0.25 * scaleX * scaleY * entity.size.x * entity.size.y);
    } else if (entity.shape === 'rect') {
        return area + $Math.abs(scaleX * scaleY * entity.size.x * entity.size.y);
    } else {
        if (! is_array(entity.shape)) { $error('entity.shape must be rect, disk, or an array of points'); }

        // Walk around the triangle fan, ignoring signs and 
        // factoring out the 0.5 per triangle
        let polyArea = 0;
        for (let i = 1; i < entity.shape.length - 1; ++i) {
            const A = entity.shape[0];
            const B = entity.shape[i];
            const C = entity.shape[i + 1];

            // triangle area = 1/2 (C - A) x (B - A) 
            polyArea += (C.x - A.x) * (B.y - A.y) - (C.y - A.y) * (B.x - A.x);
        }

        return area + scaleX * scaleY * 0.5 * $Math.abs(polyArea);
    }
}


// Add any default fields needed for an overlaps() test and return the
// cleaned up object. If everything is present, returns the object
// unmodified, otherwise clones it and adds the properties to the clone.
function $cleanupRegion(A) {
    if ((A.scale === undefined) || (typeof(A.scale) === 'number') || (A.pos === undefined) || (A.shape === undefined) || (A.size === undefined)) {
        
        if ((A.x !== undefined) && (A.y !== undefined)) {
            // This is a point. Default to disk because it makes
            // collision tests simpler.
            A = {pos:A, shape: 'disk'};
        }
        
        // Make a new object with default properties
        A = Object.assign({scale: xy(1, 1), size: xy(0, 0), angle: 0, shape: 'rect'}, A);

        if (typeof(A.scale) === 'number') {
            A.scale = xy(A.scale, A.scale);
        }
    
        if (A.corner && ! A.pos) {
            A.pos = {x: A.corner.x + 0.5 * A.size.x * $Math.abs(A.scale.x),
                     y: A.corner.y + 0.5 * A.size.y * $Math.abs(A.scale.y)}
            
            if (A.angle !== 0) {
                $error('Cannot use non-zero angle with a corner rect');
            }

            // Remove the corner property, which was a clone, to
            // avoid the upcoming check for both corner and pos.
            delete A.corner;
        }
    }

    if (A.corner) {
        $error('Cannot use both corner and pos on the same object');
    }

    if (! A.pos) {
        A.pos = {x: 0, y: 0};
    }
    
    if (A.pivot && (A.pivot.x !== 0 || A.pivot.y !== 0)) {
        // Apply the pivot, cloning the entire object for simplicity
        A = Object.assign({}, A);
        A.pos = $maybeApplyPivot(A.pos, A.pivot, A.angle, A.scale);
        delete A.pivot;
    }

    
    // All required properties are present
    return A;
}

// Appends e and all of its descendants to array output
function $getDescendants(e, output) {
    if (e) {
        output.push(e);
        if (e.child_array) {
            for (let i = 0; i < e.child_array.length; ++i) {
                $getDescendants(e.child_array[i], output);
            }
        }
    }
}


function random_within_region(region, recurse, rng) {
    if (recurse === undefined) { recurse = true; }
    if (rng === undefined) { rng = random; }

    if (recurse) {
        // Child case
        const entity_array = [], area_array = [];
        $getDescendants(region, entity_array);

        // Compute total area
        let total_area = 0;
        for (let e = 0; e < entity_array.length; ++e) {
            const entity = entity_array[e] = $cleanupRegion(entity_array[e]);
            total_area += area_array[e] = entity_area(entity);
        }

        // Choose proportional to area
        let r = rng(0, total_area);
        for (let e = 0; e < entity_array.length; ++e) {
            r -= area_array[e];
            if (r <= 0 || e === entity_array.length - 1) {
                return random_within_region(entity_array[e], false, rng);
            }
        }
        
    } else {
        // Single region case
        region = $cleanupRegion(region);

        let P;
        switch (region.shape) {
        case 'disk':
            P = random_within_circle(rng);
            P.x *= 0.5 * region.size.x; P.y *= 0.5 * region.size.y;
            break;
            
        case 'rect':
            P = random_within_square(rng);
            P.x *= 0.5 * region.size.x; P.y *= 0.5 * region.size.y;
            break;
            
        case 'point':
            return xy(region.pos);

        default:
            if (is_array(region.shape)) {
                P = $random_within_poly(region.shape, rng);
            } else {
                $error('Illegal shape: ' + region.shape);
            }
        }

        return transform_es_to_ws(region, P);

    } // recurse
}


// Function to compute the area of a triangle
function $triangle_area(A, B, C) {
    return Math.abs(A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y)) * 0.5;
}


function random_within_tri(A, B, C, rng = random) {
    const r1 = rng(0, 1);
    const r2 = rng(0, 1);
    const sqrtR1 = Math.sqrt(r1);

    const x = (1 - sqrtR1) * A.x + (sqrtR1 * (1 - r2)) * B.x + (sqrtR1 * r2) * C.x;
    const y = (1 - sqrtR1) * A.y + (sqrtR1 * (1 - r2)) * B.y + (sqrtR1 * r2) * C.y;

    return {x: x, y: y};
}


// Function to generate a random point in a convex polygon
function $random_within_poly(poly, rng = random) {
    // Compute the areas of all the triangles formed by the vertices and the first vertex
    const areas = [];
    let totalArea = 0;

    for (let i = 1; i < poly.length - 1; ++i) {
        const area = $triangle_area(poly[0], poly[i], poly[i + 1]);
        areas.push(area);
        totalArea += area;
    }

    // Choose a triangle randomly proportional to its area
    const targetArea = rng(0, totalArea);
    let accumulatedArea = 0;
    let chosenTriangleIndex = 0;

    for (let i = 0; i < areas.length; ++i) {
        accumulatedArea += areas[i];
        if (accumulatedArea >= targetArea) {
            chosenTriangleIndex = i;
            break;
        }
    }

    const A = poly[0];
    const B = poly[chosenTriangleIndex + 1];
    const C = poly[chosenTriangleIndex + 2];

    // Generate a random point within the chosen triangle
    return random_within_tri(A, B, C, rng);
}


function $distanceSquared2D(u, v) { return $square(u.x - v.x) + $square(u.y - v.y); }


/** True if the objects overlap. Positions are centers. Sizes are
    width, height vectors.  Angles are counter-clockwise radians from
    +x to +y. Shapes are 'rect' or 'disk'. If 'disk', the size x
    and y must be the same.  */
var overlaps = (function() {
  

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
        const center = $toFrame(A, temp2, temp);
        const angle  = (B.angle - A.angle) * rotation_sign();

        // Find the extremes of the corners of B along each axis of A
        const c = $Math.cos(angle);
        const s = $Math.sin(angle);

        let loX =  Infinity, loY =  Infinity;
        var hiX = -Infinity, hiY = -Infinity;

        // Four corners = four combinations of signs. Expand out the
        // vector operations to avoid memory allocation.
        for (let signX = -1; signX <= +1; signX += 2) {
            for (let signY = -1; signY <= +1; signY += 2) {
                const xx = signX * B.size.x * 0.5 * $Math.abs(B.scale.x);
                const yy = signY * B.size.y * 0.5 * $Math.abs(B.scale.y);
                const cornerX = xx *  c + yy * s;
                const cornerY = xx * -s + yy * c;

                loX = $Math.min(loX, cornerX);
                loY = $Math.min(loY, cornerY);

                hiX = $Math.max(hiX, cornerX);
                hiY = $Math.max(hiY, cornerY);
            }
        }

        loX += center.x;
        loY += center.y;
        hiX += center.x;
        hiY += center.y;
        
        // We can now perform an AABB test to see if there is no separating
        // axis under this projection
        return ((loX * 2 <= A.size.x * $Math.abs(A.scale.x)) && (hiX * 2 >= -A.size.x * $Math.abs(A.scale.x)) &&
                (loY * 2 <= A.size.y * $Math.abs(A.scale.y)) && (hiY * 2 >= -A.size.y * $Math.abs(A.scale.y)));
    }

    return function(A, B, recurse) {
        // Fast early-out for the common case when the objects are far apart and simple
        if (A && B && A.pos && B.pos && A.size && B.size &&
            (recurse === false ||
             (! A.child_array || A.child_array.length === 0) &&
             (! B.child_array || B.child_array.length === 0))) {

            // Compute a bounding disk based on both object's obj.size bounding box,
            // and square its radius.
            let r = A.scale ? ($Math.hypot(A.scale.x * A.size.x, A.scale.y * A.size.y)) : $Math.hypot(A.size.x, A.size.y);
            r += B.scale ? ($Math.hypot(B.scale.x * B.size.x, B.scale.y * B.size.y)) : $Math.hypot(B.size.x, B.size.y);
            // r = sqrt((A/2)^2) + sqrt((B/2)^2)
            // r = sqrt(A^2/4) + sqrt(B^2/4)
            // r = [sqrt(A^2) + sqrt(B^2)]/2
            // r = [sqrt(A^2) + sqrt(B^2)]/2

            // These objects are trivially far apart, don't bother with more expensive tests
            if ($square(A.pos.x - B.pos.x) + $square(A.pos.y - B.pos.y) > $square(r * 0.5)) {
                // console.log('Bounding box reject');
                return false;
            }
        }
        
        if (A === undefined) { $error('First argument to overlaps() must not be nil'); }
        if (B === undefined) { $error('Second argument to overlaps() must not be nil'); }

        if (((recurse === undefined) || recurse) &&
            ((A.child_array && (A.child_array.length > 0)) ||
             (B.child_array && (B.child_array.length > 0)))) {

            // Handle all combinations of chidren here
            const AArray = [], BArray = [];
            $getDescendants(A, AArray);
            $getDescendants(B, BArray);
            for (let i = 0; i < AArray.length; ++i) {
                for (let j = 0; j < BArray.length; ++j) {
                    if (overlaps(AArray[i], BArray[j], false)) {
                        return true;
                    }
                }
            }
            return false;
        }

        A = $cleanupRegion(A); B = $cleanupRegion(B);
        
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
            return $distanceSquared2D(A.pos, temp2) * 4 <= $square(A.size.x * $Math.abs(A.scale.x) + B.size.x * $Math.abs(B.scale.x));

        } else if ((B.size.x === 0) && (B.size.y === 0) && (A.angle === 0)) {

            // Trivial axis-aligned test against a rectangle
            return ($Math.abs(B.pos.x - A.pos.x) * 2 <= $Math.abs(A.size.x * A.scale.x) &&
                    $Math.abs(B.pos.y - A.pos.y) * 2 <= $Math.abs(A.size.y * A.scale.y));
    
        } else if (B.shape === 'disk') {
            // Box A vs. Disk B 
            
            // Algorithm derivation:
            // http://stackoverflow.com/questions/401847/circle-rectangle-collision-detection-intersection
            
            // Compute the position of the center of disk B in the
            // object space of box A.  Exploit symmetry in object
            // space by moving to the first quadrant. Then, make P
            // twice as big so that we can compare to diameters
            // instead of radii below.
            const P = $toFrame(A, temp2, temp);
            P.x = 2 * $Math.abs(P.x); P.y = 2 * $Math.abs(P.y);

            const ADiameterX = A.size.x * $Math.abs(A.scale.x);
            const ADiameterY = A.size.y * $Math.abs(A.scale.y);
            const BDiameterX = B.size.x * $Math.abs(B.scale.x);
            const BDiameterY = BDiameterX; // Because it is a disk!

            // Rect A is at the origin and axis aligned, disk B is at P/2
            if ((P.x > ADiameterX + BDiameterX) || (P.y > ADiameterY + BDiameterY)) {
                // Trivially outside by box-box overlap test
                //console.log('Box-Disk: Trivially outside');
                return false;
            } else if ((P.x <= ADiameterX) || (P.y <= ADiameterY)) {
                // Trivially inside because the disk B overlaps one of
                // the edges (or is inside) and is not trivially
                // outside.  Note that we tested twice the absolute
                // position against twice the radius. This is an "OR"
                // instead of "AND" condition because the trivially
                // outside test already ensured that they could
                // potentially overlap.
                //console.log('Box-Disk: Trivially inside');
                return true;
            } else {
                // Must be in the "corner" case. Note that these
                // squared expressions are all implicitly multipled
                // by four because of the use of diameters instead of
                // radii.
                temp2.x = ADiameterX;
                temp2.y = ADiameterY;
                //console.log('Box-Disk: Corner case');
                return $distanceSquared2D(P, temp2) <= $square(BDiameterX);
            }       
            
        } else if ((A.angle === 0) && (B.angle === 0)) {
            
            // Axis-aligned Box-Box: 2D interval overlap
            return (($Math.abs(A.pos.x - temp2.x) * 2 <= ($Math.abs(A.size.x * A.scale.x) + $Math.abs(B.size.x * B.scale.x))) &&
                    ($Math.abs(A.pos.y - temp2.y) * 2 <= ($Math.abs(A.size.y * A.scale.x) + $Math.abs(B.size.y * B.scale.x))));
        
        } else {
            
            // Oriented Box-box (http://www.flipcode.com/archives/2D_OBB_Intersection.shtml)
            return obbOverlapOneWay(A, B, offsetX, offsetY) && obbOverlapOneWay(B, A, -offsetX, -offsetY);
            
        }
    };
})();


function set_pause_menu(...options) {
    if (options.length > 3) { $error("At most three custom menu options are supported."); }
    for (let i = 0; i < options.length; ++i) {
        if (options[i].text === undefined) {
            $error('set_pause_menu() options must be objects with text properties');
        }
    }
    $customPauseMenuOptions = clone(options);
}


function any_button_press(gamepad) {
    if (gamepad === undefined) {
        return any_button_press(gamepad_array[0]) || any_button_press(gamepad_array[1]) || any_button_press(gamepad_array[2]) || any_button_press(gamepad_array[3]) || touch.aa;
    } else {
        return gamepad.aa || gamepad.bb || gamepad.cc || gamepad.dd || gamepad.ee || gamepad.ff || gamepad.qq;
    }
}


function any_button_release(gamepad) {
    if (gamepad === undefined) {
        return any_button_release(gamepad_array[0]) || any_button_release(gamepad_array[1]) || any_button_release(gamepad_array[2]) || any_button_release(gamepad_array[3]) || touch.released_a;
    } else {
        return gamepad.released_a || gamepad.released_b || gamepad.released_c || gamepad.released_d || gamepad.released_e || gamepad.released_f || gamepad.released_q;
    }
}


function random_truncated_gaussian(mean, std, radius, rng) {
    rng = rng || random;
    if (radius === undefined) { radius = 2.5 * std; }
    var g = 0;
    do {
        g = random_gaussian(mean, std, rng);
    } while (g < mean - radius || g > mean + radius);
    return g;
}


function random_truncated_gaussian2D(mean, std, radius, rng) {
    rng = rng || random;
    if (radius === undefined) {
        throw Error("random_truncated_gaussian2D(mean, stddev, radius, random) requires 3 or 4 arguments.");
    }

    if (is_number(std)) { std = {x: std, y: std}; }
    if (is_number(mean)) { mean = {x: mean, y: mean}; }
    if (is_number(radius)) { radius = {x: radius, y: radius}; }

    var X = std.x / radius.x;
    var Y = std.y / radius.y;
    var r;
    do {
        r = rng();
        if (r > 0) {
            r = $Math.sqrt(-2 * $Math.log(r));
        }
    } while (square(r * X) + square(r * Y) > 1);
    var q = rng(0, 2 * $Math.PI);
    var g1 = r * $Math.cos(q);
    var g2 = r * $Math.sin(q);
    return {x: g1 * std.x + mean.x, y: g2 * std.y + mean.y};
}


function random_gaussian(mean, std, rng) {
    rng = rng || random;
    if (std === undefined) {
        if (mean !== undefined) {
            throw Error("random_gaussian(mean, stddev, random) requires 0, 2, or 3 arguments.");
        }
        std = 1;
        mean = 0;
    }
    var r = rng();
    if (r > 0) {
        r = $Math.sqrt(-2 * $Math.log(r));
    }
    var q = rng(0, 2 * $Math.PI);
    var g1 = r * $Math.cos(q);
    return g1 * std + mean;    
}

function random_gaussian3D(mean, std, rng) {
    rng = rng || random;
    if (std === undefined) {
        if (mean !== undefined) {
            throw Error("random_gaussian3D(mean, stddev, random) requires 0, 2, or 3 arguments.");
        }
        std = {x: 1, y: 1, z: 1};
        mean = {x: 0, y: 0, z: 0};
    }
    if (is_number(std)) { std = {x: std, y: std, z: std}; }
    if (is_number(mean)) { mean = {x: mean, y: mean, z: mean}; }
    var g = random_gaussian2D(mean, std, rng);
    g.z = random_gaussian(mean.z, std.z, rng);
    return g;
}

function random_truncated_gaussian3D(mean, std, radius, rng) {
    rng = rng || random;
    if (radius === undefined) {
        throw Error("random_truncated_gaussian3D(mean, stddev, radius, random) requires 3 or 4 arguments.");
    }
    if (is_number(std)) { std = {x: std, y: std, z: std}; }
    if (is_number(mean)) { mean = {x: mean, y: mean, z: mean}; }
    if (is_number(radius)) { mean = {x: radius, y: radius, z: radius}; }

    var center = {x: 0, y: 0, z: 0};
    var g;

    do {
        g = {x: random_gaussian(0, std.x, rng),
             y: random_gaussian(0, std.y, rng),
             z: random_gaussian(0, std.z, rng)};
    } while (square(g.x / radius.x) + square(g.y / radius.y) + square(g.z / radius.z) > 1);
    
    return {x: g.x + mean.x, y: g.y + mean.y, z: g.z + mean.z};
}


function random_gaussian2D(mean, std, rng) {
    rng = rng || random;
    if (std === undefined) {
        if (mean !== undefined) {
            throw Error("random_gaussian2D(mean, stddev, random) requires 0, 2, or 3 arguments.");
        }
        std = {x: 1, y: 1};
        mean = {x: 0, y: 0};
    }

    if (is_number(std)) { std = {x: std, y: std}; }
    if (is_number(mean)) { mean = {x: mean, y: mean}; }
    
    var r = rng();
    if (r > 0) {
        r = $Math.sqrt(-2 * $Math.log(r));
    }
    var q = rng(0, 2 * $Math.PI);
    var g1 = r * $Math.cos(q);
    var g2 = r * $Math.sin(q);
    return {x: g1 * std.x + mean.x, y: g2 * std.y + mean.y};
}

function random_within_square(rng) {
    rng = rng || random;
    return {x: rng(-1, 1), y: rng(-1, 1)};
}

function random_within_cube(rng) {
    rng = rng || random;
    return {x: rng(-1, 1), y: rng(-1, 1), z: rng(-1, 1)};
}

function random_sign(rng) {
    rng = rng || random;
    return (rng() < 0.5) ? -1 : +1;
}

function random_on_square(rng) {
    rng = rng || random;
    if (rng() < 0.5) {
        return {x: random_sign(), y: rng(-1, 1)};
    } else {
        return {x: rng(-1, 1), y: random_sign()};
    }
}

function random_on_cube(rng) {
    rng = rng || random;
    var r = rng() < 1/3;
    if (r < 1/3) {
        return {x: random_sign(), y: rng(-1, 1), z: rng(-1, 1)};
    } else if (r < 2/3) {
        return {x: rng(-1, 1), y: random_sign(), z: rng(-1, 1)};
    } else {
        return {x: rng(-1, 1), y: rng(-1, 1), z: random_sign()};
    }
}

function random_on_sphere(rng) {
    rng = rng || random;
    const a = $Math.acos(rng(-1, 1)) - $Math.PI / 2;
    const b = rng(0, $Math.PI * 2);
    const c = $Math.cos(a);
    return {x: c * $Math.cos(b), y: c * $Math.sin(b), z: $Math.sin(a)};
}

var random_direction3D = random_on_sphere;

function random_on_circle() {
    const t = random() * 2 * $Math.PI;
    return {x: $Math.cos(t), y: $Math.sin(t)};
}

var random_direction2D = random_on_circle;

function random_within_circle(rng) {
    rng = rng || random;
    const P = {x:0, y:0}
    let m = 0;
    do {
        P.x = rng(-1, 1);
        P.y = rng(-1, 1);
        m = P.x * P.x + P.y * P.y;
    } while (m > 1);
    return P;
}


function random_within_sphere(rng) {
    rng = rng || random;
    const P = {x:0, y:0, z:0}
    let m = 0;
    do {
        P.x = rng(-1, 1);
        P.y = rng(-1, 1);
        P.z = rng(-1, 1);
        m = P.x * P.x + P.y * P.y + P.z * P.z;
    } while (m > 1);
    return P;
}


function $makeRng(seed) {
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

    function set_random_seed(seed) {
        if (seed === undefined) {
            seed = local_time().millisecond;
        } else if (seed === 0) {
            seed = 4.7499362e+13;
        }
        if (seed < 2**16) { seed += seed * 1.3529423483002e15; }
        state0U = $Math.abs(seed / 2**24) >>> 0;

        // Avoid all zeros
        if (state0U === 0) { state0U = 5662365; }
        
        state0L = $Math.abs(seed) >>> 0;
        state1U = $Math.abs(seed / 2**16) >>> 0;
        state1L = $Math.abs(seed / 2**32) >>> 0;
        //$console.log(seed, state0U, state0L, state1U, state1L)
    }

    set_random_seed(seed);

    function random(lo, hi) {
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
        
        var r = resU * 2.3283064365386963e-10 + (resL >>> 12) * 2.220446049250313e-16;
        if (hi === undefined) {
            if (lo === undefined) {
                return r;
            } else {
                $error("Use random() or random(lo, hi). A single argument is not supported.");
            }
        } else {
            return r * (hi - lo) + lo;
        }
    }

    return [random, set_random_seed];
}
        
var [random, set_random_seed] = $makeRng(0);

function make_random(seed) {
    var [random, set_random_seed] = $makeRng(seed || (local_time().millisecond * 1e6));
    return random;
}

function random_integer(lo, hi, rng) {
    if (hi === undefined) {
        if (lo === undefined) {
            $error("random_integer(lo, hi, random = random) requires at least two arguments.");
        }
        // Backwards compatibility
        hi = lo;
        lo = 0;        
    }
    rng = rng || random;
    return $Math.min(hi, floor(rng(lo, hi + 1)));
}


// Calls to mutate are emitted by mutating operator processing, for example +=.
// This is use to avoid double-evaluation of r-values.
function $mutate(obj, key, op, val) {
    return obj[key] = op(obj[key], val);
}

//////////////////////////////////////////////////////////////////////////////

function $stringify(b) {
    if (b === undefined) {
        return '∅';
    } else if (b === Infinity) {
        return '∞';
    } else if (b === -Infinity) {
        return '-∞';
    } else {
        return b;
    }

    return b;
}


// Note that add includes concatenation
function $add(a, b) {
    // Keep short to encourage inlining
    const t = typeof a;
    return ((t === 'object') && (a !== null)) ?
        $objectAdd(a, b) :
        (t === 'string') ?
        a + $stringify(b) :
        a + b;
}


function $addMutate(a, b) {
    const t = typeof a;
    return ((t === 'object') && (a !== null)) ?
        $objectAddMutate(a, b) :
        (t === 'string') ?
        a += $stringify(b) :
        a += b;
}

function $objectAdd(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) { $error('Cannot use + with arrays'); }
    
    // clone, preserving prototype
    const c = a.constructor ? a.constructor() : $Object.create(null);

    // avoid hasOwnProperty for speed
    if (typeof b === 'object') for (const key in a) c[key] = a[key] + b[key];
    else                       for (const key in a) c[key] = a[key] + b;
    
    return c;
}

function $objectAddMutate(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) { $error('Cannot use += with arrays'); }
    
    if (typeof b === 'object') for (let key in a) a[key] += b[key];
    else                       for (let key in a) a[key] += b;
    return a;
}

/////////////////////////////////////////////////////////////////////////////

function $neg(a) {
    return ((typeof a === 'object') && (a !== null)) ? $objectNeg(a) : -a;
}

function $objectNeg(a) {
    if (Array.isArray(a)) { $error('Cannot use - with arrays'); }
    let c = a.constructor ? a.constructor() : $Object.create(null);
    for (let key in a) c[key] = -a[key];
    return c;
}

/////////////////////////////////////////////////////////////////////////////

function $sub(a, b) {
    return ((typeof a === 'object') && (a !== null)) ? $objectSub(a, b) : a - b;
}

function $subMutate(a, b) {
    return ((typeof a === 'object') && (a !== null)) ? $objectSubMutate(a, b) : a -= b;
}

function $objectSub(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) { $error('Cannot use - with arrays'); }
    const c = a.constructor ? a.constructor() : $Object.create(null);
    
    if (typeof b === 'object') for (const key in a) c[key] = a[key] - b[key];
    else                       for (const key in a) c[key] = a[key] - b;
    
    return c;
}

function $objectSubMutate(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) { $error('Cannot use -= with arrays'); }
    if (typeof b === 'object') for (const key in a) a[key] -= b[key];
    else                       for (const key in a) a[key] -= b;
    return a;
}

/////////////////////////////////////////////////////////////////////////////

function $div(a, b) {
    return ((typeof a === 'object') && (a !== null)) ? $objectDiv(a, b) : a / b;
}

function $divMutate(a, b) {
    return ((typeof a === 'object') && (a !== null)) ? $objectDivMutate(a, b) : a /= b;
}

function $objectDiv(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) { $error('Cannot use / with arrays'); }    
    const c = a.constructor ? a.constructor() : $Object.create(null);

    if (typeof b === 'object') for (const key in a) c[key] = a[key] / b[key];
    else {
        b = 1 / b;
        for (const key in a) c[key] = a[key] * b;
    }
    
    return c;
}

function $objectDivMutate(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) { $error('Cannot use /= with arrays'); }    
    if (typeof b === 'object') for (const key in a) a[key] /= b[key];
    else {
        b = 1 / b;
        for (const key in a) a[key] *= b;
    }
    return a;
}

/////////////////////////////////////////////////////////////////////////////

function $mul(a, b) {
    // Special case: allow number * object
    return ((typeof a === 'object') && (a !== null)) ?
        $objectMul(a, b) :
        ((typeof b === 'object') && (b !== null)) ?
        $objectMul(b, a) :
        a * b;
}

function $mulMutate(a, b) {
    return ((typeof a === 'object') && (a !== null)) ? $objectMulMutate(a, b) : a *= b;
}

function $objectMul(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) { $error('Cannot use * with arrays'); }    
    const c = a.constructor ? a.constructor() : $Object.create(null);

    if (typeof b === 'object') for (const key in a) c[key] = a[key] * b[key];
    else                       for (const key in a) c[key] = a[key] * b;
    
    return c;
}

function $objectMulMutate(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) { $error('Cannot use *= with arrays'); }    
    if (typeof b === 'object') for (const key in a) a[key] *= b[key];
    else                       for (const key in a) a[key] *= b;
    return a;
}

/////////////////////////////////////////////////////////////////////////////

// vector operators:

function abs(a) {
    if (typeof a === 'object') {
        let c = a.constructor ? a.constructor() : $Object.create(null);
        for (let key in a) c[key] = $Math.abs(a[key]);
        return c;
    } else {
        return $Math.abs(a);
    }
}

function floor(a, u) {
    if (typeof a === 'object') {
        const c = a.constructor ? a.constructor() : $Object.create(null);

        if (u === undefined) {
            for (let key in a) c[key] = $Math.floor(a[key]);
        } else {
            for (let key in a) c[key] = $Math.floor(a[key] / u) * u;
        }
        return c;
    } else if (u === undefined) {
        return $Math.floor(a);
    } else {
        return $Math.floor(a / u) * u;
    }
}


function ceil(a, u) {
    if (typeof a === 'object') {
        const c = a.constructor ? a.constructor() : $Object.create(null);
        if (u === undefined) {
            for (let key in a) c[key] = $Math.ceil(a[key]);
        } else {
            for (let key in a) c[key] = $Math.ceil(a[key] / u) * u;
        }
        return c;
    } else if (u === undefined) {
        return $Math.ceil(a);
    } else {
        return $Math.ceil(a / u) * u;
    }
}


function round(a, unit) {
    if (typeof a === 'object') {
        if (unit === 0) {
            return clone(a);
        } else {
            const c = a.constructor ? a.constructor() : $Object.create(null);
            unit = unit || 1;
            const invUnit = 1 / unit;
            for (let key in a) c[key] = $Math.round(a[key] * invUnit) * unit;
            return c;
        }
    } else if (unit !== undefined) {
        if (unit === 0) {
            // No rounding
            return a;
        } else {
            return $Math.round(a / unit) * unit;
        }
    } else {
        return $Math.round(a);
    }
}

function trunc(a) {
    if (typeof a === 'object') {
        let c = a.constructor ? a.constructor() : $Object.create(null);
        for (let key in a) c[key] = $Math.trunc(a[key]);
        return c;
    } else {
        return $Math.trunc(a);
    }
}

function sign(a) {
    if (typeof a === 'object') {
        let c = a.constructor ? a.constructor() : $Object.create(null);
        for (let key in a) c[key] = $Math.sign(a[key]);
        return c;
    } else {
        return $Math.sign(a);
    }
}


function is_array(a) {
    return Array.isArray(a);
}


function is_function(a) {
    return typeof a === 'function';
}


function is_nil(a) {
    return (a === undefined) || (a === null);
}

function is_number(a) {
    return typeof a === 'number';
}


function is_boolean(a) {
    return typeof a === 'boolean';
}


function is_string(a) {
    return typeof a === 'string';
}


function type(a) {
    if (is_array(a)) {
        return 'array';
    } else if (is_nil(a)) {
        return 'nil';
    } else {
        return typeof a;
    }
}


function is_object(a) {
    return ! is_array(a) && (typeof a === 'object');
}


function clone(a) {
    if (! a || (a.$type !== undefined && a.$type !== 'map')) {
        // Built-in that is not a map; maps are treated
        // specially as an only partly-immutable asset.
        return a;
    } else if (a.$type === 'map') {
        // Maps are a special case, where we want the full layer
        // structure and arrays preserved when cloning, instead of
        // pointers.
        return deep_clone(a);
    } else if (typeof a === 'object') {
        // Includes arrays; we have to copy the non-indexed properties,
        // so we treat them as objects.
        const c = a.constructor ? a.constructor() : $Object.create(null);
        return $Object.assign(c, a);
    } else {
        return a;
    }
}


// The "map" argument is a map from original object pointers to their
// existing clones during this particular cloning.
//
// The is_map_asset argument refers to whether the 'a' argument is
// an asset that is a game map, or is a part of a game map, which
// is a special case for the sealing and finalization rules.
//
// Does not clone quadplay assets that have a $type field, except
// for game maps.
function $deep_clone(a, map, is_map_asset, makeImmutable) {
    if (! a || (a.$type !== undefined && a.$type !== 'map')) {
        // Built-in; return directly instead of cloning since it is
        // immutable (this is based on the assumption that quadplay
        // makes frozen recursive, which it does).
        return a;
    } else if (Array.isArray(a)) {
        let x = map.get(a);
        if (x !== undefined) {
            // Already cloned
            return x;
        } else {
            // Clone the array structure and store the new value in
            // the memoization map
            map.set(a, x = a.slice(0));

            if (is_map_asset === undefined) {
                is_map_asset = (a.$type === 'map');
            }

            // Clone array elements
            for (let i = 0; i < x.length; ++i) {
                x[i] = $deep_clone(x[i], map, is_map_asset, makeImmutable);
            }
            
            // Clone all non-Array properties that might have been
            // added to this array.  They are distinguished by
            // names that are not numbers.
            const k = $Object.keys(a);
            for (let i = 0; i < k.length; ++i) {
                const key = k[i];
                if (key[0] > '9' || key[0] < '0') {
                    if ((key === '$name') && (a.$name[0] !== '«')) {
                        x[key] = '«cloned ' + a.$name + '»';
                    } else {
                        x[key] = $deep_clone(a[key], map, is_map_asset, makeImmutable);
                    }
                }
            }

            if (makeImmutable) { Object.freeze(x); }

            if (is_map_asset) {
                if ($Object.isSealed(a)) { $Object.seal(x); }
                if ($Object.isFrozen(a)) { $Object.freeze(x); }
            }

            return x;
        }
    } else if (typeof a === 'object') {
        $console.assert(a.$type === undefined);
        
        let x = map.get(a);
        if (x !== undefined) {
            // Already cloned
            return x;
        } else {
            map.set(a, x = a.constructor ? a.constructor() : $Object.create(null));
            const k = $Object.keys(a);
            for (let i = 0; i < k.length; ++i) {
                const key = k[i];
                if (key === '$name') {
                    if (a.$name[0] !== '«') {
                        x.$name = '«cloned ' + a.$name + '»';
                    } else {
                        x.$name = a.$name;
                    }
                } else {
                    x[key] = $deep_clone(a[key], map, is_map_asset, makeImmutable);
                }
            }
            
            if (makeImmutable) {
                // Precompute for colors to speed particle systems
                if ((x.r === undefined && x.g === undefined && x.b === undefined) ||
                    (x.h === undefined && x.s === undefined && x.v === undefined)) {
                    x.$color = $colorToUint16(x);
                }
                
                Object.freeze(x);
            }

            if (a.$name && $Object.isSealed(a)) { $Object.seal(x); }
            return x;
        }
    } else {
        // Other primitive; just return the value
        return a;
    }
}


function deep_clone(a) {
    return $deep_clone(a, new Map());    
}


function deep_immutable_clone(a) {
    return $deep_clone(a, new Map(), false, true);    
}


function copy(s, d) {
    if (Array.isArray(s)) {
        if (! Array.isArray(d)) { $error("Destination must be an array"); }
        d.length = s.length;
        for (let i = 0; i < s.length; ++i) {
            d[i] = s[i];
        }
        return d;
    } else if (typeof s === 'object') {
        if (typeof d !== 'object') { $error("Destination must be an object"); }
        return $Object.assign(d, s);
    } else {
        $error("Not an array or object");
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
            let c = a.constructor ? a.constructor() : $Object.create(null);
            c[0] = a[1] * b[2] - a[2] * b[1];
            c[1] = a[2] * b[0] - a[0] * b[2];
            c[2] = a[0] * b[1] - a[1] * b[0];
            return c;
        }
    } else if (a.z === undefined) {
        // 2D
        return a.x * b.y - a.y * b.x;
    } else {
        let c = a.constructor ? a.constructor() : $Object.create(null);
        c.x = a.y * b.z - a.z * b.y;
        c.y = a.z * b.x - a.x * b.z;
        c.z = a.x * b.y - a.y * b.x;
        return c;
    }
}

// Inner product. Always returns a Number.
function dot(a, b) {
    if (typeof a === 'number') { return a * b; }
    let s = 0;
    for (let key in a) s += a[key] * b[key];
    return s;
}


function lowercase(s) {
    return s.toLowerCase();
}


function uppercase(s) {
    return s.toUpperCase();
}


function capitalized(s) {
    return s.replaceAll(/(^|[ 0-9.,#$%\^&*!\?@;:`~+=\-'"<>\]\[()/\\|_\n])./g, function (x) { return x.toUpperCase(); })
}


var $superscriptTable = {'0':'⁰', '1':'¹', '2':'²', '3':'³', '4':'⁴', '5':'⁵', '6':'⁶', '7':'⁷', '8':'⁸', '9':'⁹', '+':'', '-':'⁻'};

// Pads to be two digits with zeros
function $padZero(n) {
    n = $Math.min($Math.max(0, $Math.floor(n)), 99);
    if (n < 10) return '0' + n;
    else        return '' + n;
}


var $ordinal = $Object.freeze(['zeroth', 'first', 'second', 'third', 'fourth', 'fifth',
                               'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh',
                               'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth',
                               'seventeenth', 'eighteenth', 'ninteenth', 'twentieth']);
                  
function format_number(n, fmt) {
    if (fmt !== undefined && ! is_string(fmt)) { $error('The format argument to format_number must be a string'); }
    if (! is_number(n)) { $error('The number argument to format_number must be a number'); }

    let addPlus = /^ *\+/.test(fmt);
    if (addPlus) {
        fmt = fmt.replace('+', '');
        if (n < 0) { addPlus = false; }
    }

    let s;
    switch (fmt) {
    case 'percent':
    case '%':
        s = $Math.round(n * 100) + '%';
        break;
    case 'commas':
    case ',':
        s = n.toLocaleString('en');
        break;
    case 'spaces':
        s = n.toLocaleString('fr');
        break;
    case 'binary':
        s ='0b' + n.toString(2);
        break;
    case 'degrees':
    case '°':
    case 'deg':
        s = $Math.round(n * 180 / $Math.PI) + '°';
        break;
        
    case '0.#°':
    case '0.#deg':
        // Special case of optional decimal
        s = $unparseFixedDecimal(n * 180 / $Math.PI, 1) + '°';
        break;

    case 'fraction':
        {
            s = n < 0 ? '-' : '';
            const eps = 1e-10;
            n = $Math.abs(n);
            const frac = [1/4, '¼', 1/2, '½', 3/4, '¾', 1/3, '⅓', 2/3, '⅔', 1/5, '⅕'];
            for (let i = 0; i < frac.length; i += 2) {
                if ($Math.abs(frac[i] - n) < eps) {
                    return s + frac[i + 1];
                }
            }
            for (let denom = 2; denom <= 10; ++denom) {
                for (let numer = 1; numer < denom; ++numer) {
                    if ($Math.abs(numer / denom - n) < eps) {
                        return s + numer + '/' + denom;
                    }
                }
            }
            s += n;
        }
        break;
        
    case 'hex':
        if ($Math.abs(n) === Infinity) {
            s = n.toLocaleString('en');
        } else {
            s = '0x' + n.toString(16);
        }
        break;
        
    case 'scientific':
        {
            let x = $Math.floor($Math.log10($Math.abs(n)));
            if ($Math.abs(x) === Infinity) { x = 0; }
            // round to 3 decimal places in scientific notation
            s = '' + ($Math.round(n * $Math.pow(10, 3 - x)) * 1e-3);
            // If rounding failed due to precision, truncate the
            // string itself
            s = s.substring(0, $Math.min((n < 0) ? 6 : 5), s.length);
            s += '×10';
            const e = '' + x;
            for (let i = 0; i < e.length; ++i) {
                s += $superscriptTable[e.charAt(i)];
            }
            break;
        }

    case 'clock12':
        {
            n = $Math.round(n / 60);
            const m = n % 60;
            let h = $Math.floor(n / 60);
            const suffix = ((h % 24) < 12) ? 'am' : 'pm';
            h = h % 12;
            if (h === 0) { h = 12; }
            h + ':' + $padZero(m) + suffix;
            break;
        }
        
    case 'clock24':
        {
            const m = $Math.floor(n / 60) % 60;
            const h = $Math.floor(n / 3600) % 24;
            s = h + ':' + $padZero(m);
            break;
        }
    case 'stopwatch':
        {
            const m = $Math.floor($Math.abs(n) / 60) * $Math.sign(n);
            const S = $padZero(n % 60);
            const f = $padZero((n - $Math.floor(n)) * 100);
            s = m + ':' + S + '.' + f;
            break;
        }
        
    case 'oldstopwatch':
        {
            const m = $Math.floor($Math.abs(n) / 60) * $Math.sign(n);
            const S = $padZero(n % 60);
            const f = $padZero((n - $Math.floor(n)) * 100);
            s = m + '"' + S + "'" + f;
            break;
        }

    case 'ordinalabbrev':
        n = $Math.round(n);
        switch (n) {
        case 1: s = '1ˢᵗ';
        case 2: s = '2ⁿᵈ';
        case 3: s = '3ʳᵈ';
        default: s = '' + n + 'ᵗʰ';
        }
        break;

    case 'ordinal':
        n = $Math.round(n);
        if (n >= 0 && n < $ordinal.length) {
            s = $ordinal[n];
        } else {
            s = '' + n + 'ᵗʰ';
        }
        break;

    case '':
    case undefined:
        if ($Math.abs(n) === Infinity) {
            s = n.toLocaleString('en');
        } else {
            s = '' + n;
        }
        break;
        
    default:
        {
            if ($Math.abs(n) === Infinity) {
                s = n.toLocaleString('en');
            } else {
                const match = fmt.match(/^( *)(0*)(\.0+)?(°|deg|degree|degrees|%)?$/);
                if (match) {
                    let spaceNum = match[1].length;
                    const intNum = match[2].length;
                    const fracNum = match[3] ? $Math.max(match[3].length - 1, 0) : 0;
                    let suffix = match[4];
                    
                    if (suffix === 'deg' || suffix === 'degrees' || suffix === 'degree' || suffix === '') {
                        suffix = '°';
                        n *= 180 / $Math.PI;
                    } else if (suffix === '%') {
                        n *= 100;
                    }
                    
                    s = $Math.abs(n).toFixed(fracNum);
                    
                    let i = (fracNum === 0) ? s.length : s.indexOf('.');
                    while (i < intNum) { s = '0' + s; ++i; }
                    
                    // Inject sign
                    if (n < 0) { s = '-' + s; --spaceNum; }
                    
                    while (i < intNum + spaceNum) { s = ' ' + s; ++i; }
                    
                    if (suffix) { s += suffix; }
                
                } else {
                    s = '' + n;
                }
            }
        }
    } // switch

    if (addPlus) {
        if (s[0] === ' ') {
            // Leading spaces case
            s = s.replace(/ (?=[^ ])/, '+');
        } else {
            s = '+' + s;
        }
    }

    return s;
}


function shuffle(array, rng) {
    if (! Array.isArray(array)) {
        $error('The argument to shuffle() must be an array');
    }
    
    // While there remain elements to shuffle...
    for (let i = array.length - 1; i > 0; --i) {
        // Pick a remaining element...
        let j = random_integer(0, i - 1, rng);
        
        // ...and swap it with the current element.
        const temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
}


function join(array, separator, lastSeparator, lastIfTwoSeparator, empty) {
    if (array.length === 0) {
        return empty || '';
    } else if (lastIfTwoSeparator !== undefined && array.length === 2) {
        return (typeof array[0] === 'string' ? array[0] : unparse(array[0])) + lastIfTwoSeparator +
            (typeof array[1] === 'string' ? array[1] : unparse(array[1]));
    } else {
        separator = separator || '';
        if (lastSeparator === undefined) {
            lastSeparator = separator;
        }
        if (lastIfTwoSeparator === undefined) {
            lastIfTwoSeparator = lastSeparator;
        }
        let s = (typeof array[0] === 'string') ? array[0] : unparse(array[0]);
        for (let i = 1; i < array.length; ++i) {
            let a = array[i];
            if (typeof a !== 'string') {
                a = unparse(a);
            }

            if ((i === array.length - 1) && (lastSeparator !== undefined)) {
                s += lastSeparator + a;
            } else {
                s += separator + a;
            }
        }
        return s;
    }
}


function shuffled(a, rng) {
    if (Array.isArray(a)) {
        const c = clone(a);
        shuffle(c, rng);
        return c;
    } else {
        // String case
        const c = split(a);
        shuffle(c, rng);
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
        return a.split('').reverse().join('');
    }
}


function parse(source) {
    return $parse(source, 0).result;
}


function unparse(x, level = 1) {
    const colon = level === 0 ? ':' : ': ';
    const closingBraceOnNewLine = level >= 3;
    const inlineShortContainers = level < 4;
    const inlineAllContainers = level <= 1;
    const specialStructs = true;
    const html_out = false;
    const noWhitespace = level === 0; 
    
    return $unparse(x, new Map(), colon, closingBraceOnNewLine, inlineShortContainers, inlineAllContainers, noWhitespace, '', '', specialStructs, html_out);
}


/* Returns a string that has at most d decimal places. */
function $unparseFixedDecimal(n, d) {
    const k = 10**d;
    n = $Math.round((n + Number.EPSILON) * k) / k
    return n.toFixed(d).replace(/\.?0*$/, '')
}


function unparse_hex_color(c) {
    function hex(v) {
        v = $clamp($Math.floor(v * 256), 0, 255) | 0;
        return (v < 16 ? '0' : '') + v.toString(16);
    }
    
    if (c.h !== undefined) {
        if (c.a !== undefined) {
            return unparse_hex_color(rgba(c));
        } else {
            return unparse_hex_color(rgb(c));
        }
    }

    return '#' + hex(c.r) + hex(c.g) + hex(c.b) + (c.a !== undefined ? hex(c.a) : '');
}


/* Helper for $unparse */
function $unparseContainer(
    x, alreadySeen, colon, closingBraceOnNewLine,
    inlineShortContainers, inlineAllContainers, terse,
    indent, hint, specialStructs, html_out, meta = {}) {

    const INCREASE_INDENT = '    ';
    const MAX_INLINE_CONTAINER_LENGTH = 4;

    const isArray = Array.isArray(x);

    alreadySeen.set(x, true);
    
    let s = '';
    
    let first = true;
    
    let numPublicKeys = 0;
    let inline = inlineShortContainers || inlineAllContainers || terse;

    const keys = isArray ? undefined : $Object.keys(x);
    const N = isArray ? x.length : keys.length;

    if (! terse && ! inlineAllContainers) {
        // Is this a long container?
        for (let i = 0; i < N; ++i) {
            const k = isArray ? i : keys[i];
            
            if (k !== '$') {
                ++numPublicKeys;
                const v = x[k];
                if (numPublicKeys > MAX_INLINE_CONTAINER_LENGTH ||
                    Array.isArray(v) ||
                    typeof v === 'object') {
                    // Too large or recursive value
                    inline = false;
                }
            }
        }
    }

    meta.expandable = N > 0 && ! inline && html_out;

    // Are child nodes expanded by default?
    const childExpansionClass = (N > 5 || indent.length >= INCREASE_INDENT.length) ? 'class="closed"' : '';
    
    let childMeta = {};
    const childIndent = INCREASE_INDENT + indent;
    for (let i = 0; i < N; ++i) {
        const k = isArray ? i : keys[i];
        // Hide quadplay-internal members
        if (isArray || k[0] !== '$') {
            let key;
            
            // Quote illegal identifiers used as keys
            if (! isArray) {
                const legalIdentifier = /^[Δ]?(?:[A-Za-z][A-Za-z_0-9]*|[αβγδζηθιλμρσϕφχψτωΩ][_0-9]*)$/.test(k);
                key = legalIdentifier ? k : ('"' + k + '"');
            }
            
            // Close out previous
            if (first) {
                if (! inline) {
                    if (html_out) {
                        s += '<span class="hidden">\n' + childIndent + '</span>';
                    } else {
                        s += '\n' + childIndent;
                    }
                }
                first = false;
            } else if (inline) {
                // Separator
                s += (terse ? ',' : ', ');
            } else if (html_out) {
                s += ',</li><span class="hidden">\n' + childIndent + '</span>';
            } else {
                s += ',\n' + childIndent;
            }

            // For arrays, pass the array's hint as the hint
            childMeta.expandable = false;
            const child = $unparse(x[k], alreadySeen, colon, closingBraceOnNewLine, inlineShortContainers, inlineAllContainers, terse, childIndent, isArray ? hint : k, specialStructs, html_out, childMeta);

            if (html_out && ! inline) {
                s += `<li ${childExpansionClass}><span onclick="onExpanderClick(event)" class="expanderButton" style="visibility: ${childMeta.expandable ? 'visible' : 'hidden'}"></span>`;
            }
            
            if (! isArray) {
                s += key + colon;
            }

            s += child;
        }
    }
    
    if (numPublicKeys > 0 && html_out && ! inline) { s += '</li>'; }
    
    if (numPublicKeys > 0 && closingBraceOnNewLine && ! inline) {
        if (html_out) {
            s += '<span class="hidden">\n' + indent + '</span>';
        } else {
            s += '\n' + indent;
        }
    }

    if (html_out && ! inline) {
        s = '<ul>' + s + '</ul><span onclick="onExpanderClick(event)" class="expanderEllipses"></span>';
    }

    if (isArray) {
        s = '[' + s + ']';
    } else {
        s = '{' + s + '}';
    }
    
    return s;
}


/*
  `hint` is for styling. It is usually the name of the variable being
  unparsed

  `specialStructs` = true causes xy(), angle: fields, and other common
  values to pretty print instead of showing as generic objects

  `html_out` = true generates expansion HTML and escapes HTML in strings.
*/
function $unparse(
    x, alreadySeen, colon, closingBraceOnNewLine,
    inlineShortContainers, inlineAllContainers, terse, indent, hint,
    specialStructs, html_out, meta = {}) {

    if (x && x.$name !== undefined) {
        // Internal object
        const editable = ['font', 'spritesheet', 'sound', 'data', 'map'];
        if (html_out && editable.indexOf(x.$type) !== -1) {
            return `<a style="cursor:pointer; font-family: Arial" onclick="onProjectSelect(document.getElementById('projectAsset_${x.$name}'), 'asset', gameSource.assets['${x.$name}'])">${x.$name}</a>`;
        } else {
            return x.$name;
        }
    }
    
    if (Array.isArray(x)) {
        if (alreadySeen.has(x)) {
            return '[…]';
        } else {        
            return $unparseContainer(
                x, alreadySeen, colon, closingBraceOnNewLine,
                inlineShortContainers, inlineAllContainers,
                terse, indent, hint,
                specialStructs, html_out, meta);
        }
    }
    
    switch (typeof x) {
    case 'object':
        if (x === null) {
            return '∅';
        } else if (alreadySeen.has(x)) {
            return '{…}';
        } else {
            if (specialStructs && $isSimplePyxlScriptStruct(x)) {
                // Position types
                for (let j = 0; j < $unparse.pos_struct_array.length; ++j) {
                    const type = $unparse.pos_struct_array[j];
                    if ($isSimplePyxlScriptStruct(x, type)) {
                        let s = type + '(';
                        for (let i = 0; i < type.length; ++i) {
                            s += $unparseFixedDecimal(x[type[i]], 4) +
                                ((i < type.length - 1) ? ', ' : ')');
                        }
                        return s;
                    }
                }
                
                // Color types
                for (let j = 0; j < $unparse.color_struct_array.length; ++j) {
                    const type = $unparse.color_struct_array[j];
                    if ($isSimplePyxlScriptStruct(x, type)) {
                        let s = type + '(';

                        // Show percentages
                        for (let i = 0; i < type.length; ++i) {
                            s += format_number(x[type[i]], '0%') +
                                ((i < type.length - 1) ? ', ' : ')');
                        }

                        let color = s;
                        if (type[0] === 'h') {
                            // HSV -> RGB
                            const c = rgb(x);
                            c.a = (type[3] === 'a') ? x.a : 1;
                            color = `rgba(${100 * c.r}%, ${100 * c.g}%, ${100 * c.b}%, ${100 * c.a}%)`;
                        }
                        
                        if (html_out) {
                            s += ` <div style="display:inline-block; width: 32px; height: 12px; overflow: hidden; position: relative; top: 2px" class="checkerboard8"><div style="background: ${color}; width: 32px; height: 12px"></div></div>`;
                        }
                        return s;
                    }
                }
            }
            
            return $unparseContainer(
                x, alreadySeen, colon, closingBraceOnNewLine,
                inlineShortContainers, inlineAllContainers, terse,
                indent, hint,
                specialStructs, html_out, meta);
        }

    case 'boolean':
        return x ? 'true' : 'false';
        
    case 'number':
        let match;
        if (x === Infinity) {
            return '∞';
        } else if (x === -Infinity) {
            return '-∞';
        } else if (is_nan(x)) {
            return 'nan';
        } else if (specialStructs && (/(^|_|\.)Δ?(angle|heading|theta|phi|yaw|pitch|roll|θ|ϕ|Φ|Θ)(_array)?$/i.test(hint))) {
            if ($Math.abs(x) < 25 * $Math.PI / 180) {
                return format_number(x, '0.0deg');
            } else {
                return format_number(x, 'deg');
            }
        } else if (specialStructs && (/(^|_|\.)Δ?(percent|percentage|opacity|fraction|alpha|beta|α|β)(_array)?$/i.test(hint))) {
            if ($Math.abs(x) < 0.05) {
                return format_number(x, '0.0%');
            } else {
                return format_number(x, '%');
            }
        } else if (x === $Math.PI) {
            return 'π';
        } else if (x === $Math.PI / 2) {
            return '½π';
        } else if (x === $Math.PI / 4) {
            return '¼π';
        } else if (x === $Math.PI * 3 / 4) {
            return '¾π';
        } else if (x === -$Math.PI) {
            return '-π';
        } else if (x === -$Math.PI / 2) {
            return '-½π';
        } else if (x === -$Math.PI / 4) {
            return '-¼π';
        } else if (x === -$Math.PI * 3 / 4) {
            return '-¾π';
        } else {
            return '' + x;
        }

    case 'undefined':
        return '∅';
        
    case 'string':
        if (html_out) { x = $escapeHTMLEntities(x); }
        return '"' + x + '"';

    case 'function':
        if (x.name) {
            return 'function ' + x.name;
        } else {
            return 'function';
        }

    default:
        return '{builtin}';
    }
}

/* True if object contains only the fields whose single-letter names
   are in fields, or begin with $. Used for debug_watch() pretty
   printer detecting xy(), rgb(), etc.

   If fields is not supplied, only checks for the existence of
   single-letter numeric fields, but not which ones.

*/
function $isSimplePyxlScriptStruct(object, fields) {
    if (typeof object !== 'object') { return; }

    let count = 0;
    for (const key in object) {
        if (key[0] !== '$' &&
            (key.length > 1 ||
             (fields && (fields.indexOf(key) === -1)) ||
             typeof object[key] !== 'number')) { return false; }
        ++count;
    }

    return ! fields || count === fields.length;
}

$unparse.pos_struct_array = ['xy', 'xyz', 'xz'];
$unparse.color_struct_array = ['rgb', 'rgba', 'hsv', 'hsva'];


function magnitude(a) {
    if (typeof a === 'number') {
        return $Math.hypot.apply(null, arguments);
    } else {
        return $Math.sqrt(dot(a, a));
    }
}


function magnitude_squared(a) {
    if (typeof a === 'number') {
        let s = a * a;
        for (let i = 1; i < arguments.length; ++i) {
            s += arguments[i] * arguments[i];
        }
        return s;
    } else {
        return dot(a, a);
    }
}


function direction(a) {
    const m = magnitude(a);
    return (m > 1e-10) ? $mul(a, 1.0 / m) : clone(a);
}

// Used by min and max (and mid). Assumes 'this' is bound to the corresponding $Math function.
function $minOrMax(a, b) {
    const ta = typeof a, tb = typeof b;
    let allNumbers = (ta === 'number') && (tb === 'number');
    const fcn = this;

    if (allNumbers || (arguments.length > 2)) {
        // common case on only numbers
        return fcn.apply($Math, arguments);
    } else {
        if (ta === 'Number') {
            // Swap, b is the vector
            let tmp = b; b = a; a = b;
            tmp = tb; tb = ta; ta = tmp;
        }

        let c = a.constructor ? a.constructor() : $Object.create(null);
        if (tb === 'Number') for (let key in a) c[key] = fcn(a[key], b);
        else                 for (let key in a) c[key] = fcn(a[key], b[key]);
        return $Object.isFrozen(a) ? $Object.freeze(c) : c;
    }
}

// Handles any number of arguments for Numbers, two
// arguments for vectors
function max(a, b) {
    return $minOrMax.apply($Math.max, arguments);
}
    
function min(a, b) {
    return $minOrMax.apply($Math.min, arguments);
}

function mid(a, b, c) {
    return $minOrMax.apply($Math.mid, arguments);
}

function find_max_value(a) {
    if (Array.isArray) {
        if (a.length === 0) { return undefined; }
        let m = a[0], j = 0;
        for (let i = 1; i < a.length; ++i) {
            const v = a[i];
            if (v > m) {
                m = v;
                j = i;
            }
        }
        return j;
    } else {
        let m = -Infinity, j = undefined;
        for (const i in a) {
            const v = a[i];
            if (v > m) {
                m = v;
                j = i;
            }
        }        
        return j;
    }
}

function find_min_value(a) {
    if (Array.isArray) {
        if (a.length === 0) { return undefined; }
        let m = a[0], j = 0;
        for (let i = 1; i < a.length; ++i) {
            const v = a[i];
            if (v < m) {
                m = v;
                j = i;
            }
        }
        return j;
    } else {
        let m = Infinity, j = undefined;
        for (const i in a) {
            const v = a[i];
            if (v < m) {
                m = v;
                j = i;
            }
        }        
        return j;
    }
}

function max_value(a) {
    if (typeof a === 'number') { return a; }
    let s = -Infinity;
    for (let key in a) s = $Math.max(s, a[key]);
    return s;
}

function min_value(a) {
    if (typeof a === 'number') { return a; }
    let s = Infinity;
    for (let key in a) s = $Math.min(s, a[key]);
    return s;
}

// Backwards compatibility
var max_component = max_value, min_component = min_value;

function MAX(a, b) {
    return (a > b) ? a : b;
}

function MIN(a, b) {
    return (a < b) ? a : b;
}

var FLOOR = $Math.floor;
var CEIL = $Math.ceil;
var ROUND = $Math.round;

function ADD(a, b) {
    return a + b;
}

function MEAN(a, b) {
    return 0.5 * (a + b);
}

function MEAN3(a, b) {
    return (1/3) * (a + b);
}

function MEAN4(a, b, c, d) {
    return 0.25 * (a + b + c + d);
}

function SUB(a, b) {
    return a - b;
}

function MUL(a, b) {
    return a * b;
}

function SUM(array) {
    let s = 0;
    let i = array.length;
    while (i--) { s += array[i]; }
    return s;
}

function PROD(array) {
    let s = 1;
    let i = array.length;
    while (i--) { s *= array[i]; }
    return s;
}

function SIGN(a) {
    return $Math.sign(a);
}

function MAD(a, b, c) {
    return a * b + c;
}

function DIV(a, b) {
    return a / b;
}

var ABS = $Math.abs;

function CLAMP(a, lo, hi) {
    return $clamp(a, lo, hi);
}

function LERP(a, b, t) {
    return $lerp(a, b, t);
}

function XY_MAGNITUDE(a) {
    return $Math.hypot(a.x, a.y);
}

function XY_DISTANCE(a, b) {
    return $Math.hypot(a.x - b.x, a.y - b.y);
}

function XY_DIRECTION(v1, v2) {
    let mag = $Math.hypot(v1.x, v1.y);
    if (mag < 0.0000001) {
        v2.x = v2.y = 0;
    } else {
        mag = 1 / mag;
        v2.x = v1.x * mag;
        v2.y = v1.y * mag;
    }
}

function XY_MAGNITUDE(a) {
    return $Math.hypot(a.x, a.y);
}

function XYZ_MAGNITUDE(a) {
    return $Math.hypot(a.x, a.y, a.z);
}

function XYZ_DISTANCE(a, b) {
    return $Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function XZ_MAGNITUDE(a) {
    return $Math.hypot(a.x, a.z);
}

function XY_DISTANCE(a, b) {
    return $Math.hypot(a.x - b.x, a.y - b.y);
}

function XZ_DISTANCE(a, b) {
    return $Math.hypot(a.x - b.x, a.z - b.z);
}

function XZ_DIRECTION(v1, v2) {
    let mag = $Math.hypot(v1.x, v1.z);
    if (mag < 0.0000001) {
        v2.x = v2.z = 0;
    } else {
        mag = 1 / mag;
        v2.x = v1.x * mag;
        v2.z = v1.z * mag;
    }
}


function XYZ_DIRECTION(v1, v2) {
    let mag = $Math.hypot(v1.x, v1.y, v1.z);
    if (mag < 0.0000001) {
        v2.x = v2.y = v2.z = 0;
    } else {
        mag = 1 / mag;
        v2.x = v1.x * mag;
        v2.y = v1.y * mag;
        v2.z = v1.z * mag;
    }
}


function XYZ_ADD_XYZ(v1, v2, r) {
    r.x = v1.x + v2.x;
    r.y = v1.y + v2.y;
    r.z = v1.z + v2.z;
}

function XYZ_SUB_XYZ(v1, v2, r) {
    r.x = v1.x - v2.x;
    r.y = v1.y - v2.y;
    r.z = v1.z - v2.z;
}

function XYZ_MUL_XYZ(v1, v2, r) {
    r.x = v1.x * v2.x;
    r.y = v1.y * v2.y;
    r.z = v1.z * v2.z;
}

function XYZ_MUL(v1, s, r) {
    r.x = v1.x * s;
    r.y = v1.y * s;
    r.z = v1.z * s;
}

function XYZ_DIV(v1, s, r) {
    s = 1 / s;
    r.x = v1.x * s;
    r.y = v1.y * s;
    r.z = v1.z * s;
}

function XYZ_DIV_XYZ(v1, v2, r) {
    r.x = v1.x / v2.x;
    r.y = v1.y / v2.y;
    r.z = v1.z / v2.z;
}

function XYZ_CRS_XYZ(v1, v2, r) {
    const x = v1.y * v2.z - v1.z * v2.y;
    const y = v1.z * v2.x - v1.x * v2.z;
    const z = v1.x * v2.y - v1.y * v2.x;
    r.x = x; r.y = y; r.z = z;
}

function XYZ_DOT_XYZ(v1, v2) {
    return v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
}

function XY_MUL(v1, s, r) {
    r.x = v1.x * s;
    r.y = v1.y * s;
}

function XY_DIV(v1, s, r) {
    s = 1 / s;
    r.x = v1.x * s;
    r.y = v1.y * s;
}

function XY_ADD_XY(v1, v2, r) {
    r.x = v1.x + v2.x;
    r.y = v1.y + v2.y;
}

function XY_MAD_XY_XY(v1, v2, v3, r) {
    r.x = v1.x * v2.x + v3.x;
    r.y = v1.y * v2.y + v3.y;
}

function XY_MAD_S_XY(v1, s, v2, r) {
    r.x = v1.x * s + v2.x;
    r.y = v1.y * s + v2.y;
}

function XY_SUB_XY(v1, v2, r) {
    r.x = v1.x - v2.x;
    r.y = v1.y - v2.y;
}

function XY_MUL_XY(v1, v2, r) {
    r.x = v1.x * v2.x;
    r.y = v1.y * v2.y;
}

function XY_DIV_XY(v1, v2, r) {
    r.x = v1.x / v2.x;
    r.y = v1.y / v2.y;
}

function XY_DOT_XY(v1, v2) {
    return v1.x * v2.x + v1.y * v2.y;
}

function XY_CRS_XY(v1, v2) {
    return v1.x * v2.y - v1.y * v2.x;
}

function XYZ_MAD_S_XYZ(v1, s, v2, r) {
    r.x = v1.x * s + v2.x;
    r.y = v1.y * s + v2.y;
    r.z = v1.z * s + v2.z;
}


function XYZ_LERP(c1, c2, A, dst) {
    const x = (c2.x - c1.x) * A + c1.x;
    const y = (c2.y - c1.y) * A + c1.y;
    const z = (c2.z - c1.z) * A + c1.z;
    dst.x = x;
    dst.y = y;
    dst.z = z;
}

function XY_LERP(c1, c2, A, dst) {
    const x = (c2.x - c1.x) * A + c1.x;
    const y = (c2.y - c1.y) * A + c1.y;
    dst.x = x;
    dst.y = y;
}

function XZ_LERP(c1, c2, A, dst) {
    const x = (c2.x - c1.x) * A + c1.x;
    const z = (c2.z - c1.z) * A + c1.z;
    dst.x = x;
    dst.z = z;
}

function XZ_MUL(v1, s, r) {
    r.x = v1.x * s;
    r.z = v1.z * s;
}

function XZ_DIV(v1, s, r) {
    s = 1 / s;
    r.x = v1.x * s;
    r.z = v1.z * s;
}

function XZ_ADD_XZ(v1, v2, r) {
    r.x = v1.x + v2.x;
    r.z = v1.z + v2.z;
}

function XZ_SUB_XZ(v1, v2, r) {
    r.x = v1.x - v2.x;
    r.z = v1.z - v2.z;
}

function XZ_MUL_XZ(v1, v2, r) {
    r.x = v1.x * v2.x;
    r.z = v1.z * v2.z;
}

function XZ_DIV_XZ(v1, v2, r) {
    r.x = v1.x / v2.x;
    r.z = v1.z / v2.z;
}

function XZ_DOT_XZ(v1, v2) {
    return v1.x * v2.x + v1.z * v2.z;
}

function RGBA_LERP(c1, c2, A, dst) {
    const r = (c2.r - c1.r) * A + c1.r;
    const g = (c2.g - c1.g) * A + c1.g;
    const b = (c2.b - c1.b) * A + c1.b;
    const a = (c2.a - c1.a) * A + c1.a;
    dst.r = r;
    dst.g = g;
    dst.b = b;
    dst.a = a;    
}

function RGBA_ADD_RGBA(c1, c2, r) {
    r.r = c1.r + c2.r;
    r.g = c1.g + c2.g;
    r.b = c1.b + c2.b;
    r.a = c1.a + c2.a;
}

function RGBA_SUB_RGBA(c1, c2, r) {
    r.r = c1.r - c2.r;
    r.g = c1.g - c2.g;
    r.b = c1.b - c2.b;
    r.a = c1.a - c2.a;
}

function RGBA_MUL_RGBA(c1, c2, r) {
    r.r = c1.r * c2.r;
    r.g = c1.g * c2.g;
    r.b = c1.b * c2.b;
    r.a = c1.a * c2.a;
}

function RGBA_DIV_RGBA(c1, c2, r) {
    r.r = c1.r / c2.r;
    r.g = c1.g / c2.g;
    r.b = c1.b / c2.b;
    r.a = c1.a / c2.a;
}

function RGBA_MUL(c, s, r) {
    r.r = c.r * s;
    r.g = c.g * s;
    r.b = c.b * s;
    r.a = c.a * s;
}

function RGBA_DIV(c, s, r) {
    s = 1 / s;
    r.r = c.r * s;
    r.g = c.g * s;
    r.b = c.b * s;
    r.a = c.a * s;
}

function RGBA_DOT_RGBA(c1, c2) {
    return c1.r * c2.r + c1.g * c2.g + c1.b * c2.b + c1.a * c2.a;
}

function RGB_ADD(c1, s, r) {
    r.r = c1.r + s;
    r.g = c1.g + s;
    r.b = c1.b + s;
}

function RGB_ADD_RGB(c1, c2, r) {
    r.r = c1.r + c2.r;
    r.g = c1.g + c2.g;
    r.b = c1.b + c2.b;
}

function RGB_SUB_RGB(c1, c2, r) {
    r.r = c1.r - c2.r;
    r.g = c1.g - c2.g;
    r.b = c1.b - c2.b;
}

function RGB_MUL_RGB(c1, c2, r) {
    r.r = c1.r * c2.r;
    r.g = c1.g * c2.g;
    r.b = c1.b * c2.b;
}

function RGB_LERP(c1, c2, A, dst) {
    const r = (c2.r - c1.r) * A + c1.r;
    const g = (c2.g - c1.g) * A + c1.g;
    const b = (c2.b - c1.b) * A + c1.b;
    dst.r = r;
    dst.g = g;
    dst.b = b;
}

function RGB_DIV_RGB(c1, c2, r) {
    r.r = c1.r / c2.r;
    r.g = c1.g / c2.g;
    r.b = c1.b / c2.b;
}

function RGB_MUL(c, s, r) {
    r.r = c.r * s;
    r.g = c.g * s;
    r.b = c.b * s;
}

function RGB_DIV(c, s, r) {
    s = 1 / s;
    r.r = c.r * s;
    r.g = c.g * s;
    r.b = c.b * s;
}

function RGB_DOT_RGB(c1, c2) {
    return c1.r * c2.r + c1.g * c2.g + c1.b * c2.b;
}

function RGB_DISTANCE(a, b) {
    return $Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function MAT3x4_MATMUL_XYZW(A, v, c) {
    const x = v.x, y = v.y, z = v.z, w = v.w;
    c.x = A[0][0] * x + A[0][1] * y + A[0][2] * z + A[0][3] * w;
    c.y = A[1][0] * x + A[1][1] * y + A[1][2] * z + A[1][3] * w;
    c.z = A[2][0] * x + A[2][1] * y + A[2][2] * z + A[2][3] * w;
    c.w = w;
}


function MAT3x4_MATMUL_XYZ(A, v, c) {
    const x = v.x, y = v.y, z = v.z;
    c.x = A[0][0] * x + A[0][1] * y + A[0][2] * z + A[0][3];
    c.y = A[1][0] * x + A[1][1] * y + A[1][2] * z + A[1][3];
    c.z = A[2][0] * x + A[2][1] * y + A[2][2] * z + A[2][3];
}


function MAT3x3_ORTHONORMALIZE(M) {
    // Algorithm uses Gram-Schmidt orthogonalization.  If 'this' matrix is
    // M = [m0|m1|m2], then orthonormal output matrix is Q = [q0|q1|q2],
    //
    //   q0 = m0/|m0|
    //   q1 = (m1-(q0*m1)q0)/|m1-(q0*m1)q0|
    //   q2 = (m2-(q0*m2)q0-(q1*m2)q1)/|m2-(q0*m2)q0-(q1*m2)q1|
    //
    // where |V| indicates length of vector V and A*B indicates dot
    // product of vectors A and B.
    
    // compute q0
    let fInvLength = 1 / $Math.hypot(M[0][0], M[1][0], M[2][0]);

    M[0][0] *= fInvLength;
    M[1][0] *= fInvLength;
    M[2][0] *= fInvLength;

    // compute q1
    let fDot0 =
        M[0][0] * M[0][1] +
        M[1][0] * M[1][1] +
        M[2][0] * M[2][1];

    M[0][1] -= fDot0 * M[0][0];
    M[1][1] -= fDot0 * M[1][0];
    M[2][1] -= fDot0 * M[2][0];

    fInvLength = 1 / $Math.hypot(M[0][1], M[1][1], M[2][1]);

    M[0][1] *= fInvLength;
    M[1][1] *= fInvLength;
    M[2][1] *= fInvLength;

    // compute q2
    const fDot1 =
        M[0][1] * M[0][2] +
        M[1][1] * M[1][2] +
        M[2][1] * M[2][2];

    fDot0 =
        M[0][0] * M[0][2] +
        M[1][0] * M[1][2] +
        M[2][0] * M[2][2];

    M[0][2] -= fDot0 * M[0][0] + fDot1 * M[0][1];
    M[1][2] -= fDot0 * M[1][0] + fDot1 * M[1][1];
    M[2][2] -= fDot0 * M[2][0] + fDot1 * M[2][1];

    fInvLength = 1 / $Math.hypot(M[0][2], M[1][2], M[2][2]);

    M[0][2] *= fInvLength;
    M[1][2] *= fInvLength;
    M[2][2] *= fInvLength;
}


function MAT3x3_MATMUL_XYZ(A, v, c) {
    const x = v.x, y = v.y, z = v.z;
    c.x = A[0][0] * x + A[0][1] * y + A[0][2] * z;
    c.y = A[1][0] * x + A[1][1] * y + A[1][2] * z;
    c.z = A[2][0] * x + A[2][1] * y + A[2][2] * z;
}


function MAT2x2_MATMUL_XY(A, v, c) {
    const x = v.x, y = v.y;
    c.x = A[0][0] * x + A[0][1] * y;
    c.y = A[1][0] * x + A[1][1] * y;
}

function MAT2x2_MATMUL_XZ(A, v, c) {
    const x = v.x, z = v.z;
    c.x = A[0][0] * x + A[0][1] * z;
    c.z = A[1][0] * x + A[1][1] * z;
}


function lerp_angle(a, b, t) {
    a = $loop(a, -$Math.PI, $Math.PI);
    b = $loop(b, -$Math.PI, $Math.PI);

    // Find the shortest direction
    if (b > a + $Math.PI) {
        b -= 2 * $Math.PI;
    } else if (b < a - $Math.PI) {
        b += 2 * $Math.PI;
    }

    return a + (b - a) * t;    
}



// https://en.wikipedia.org/wiki/SRGB#The_reverse_transformation
function $SRGB_to_RGB_one_channel(u) {
    return u > 0.04045 ? $Math.pow(((u + 0.055) * (1 / 1.055)), 2.4) : u * (1 / 12.92);
}


// https://en.wikipedia.org/wiki/SRGB
function $RGB_to$SRGB_one_channel(u) {
    return  u > 0.0031308 ? 1.055 * $Math.pow(u, (1 / 2.4)) - 0.055 : 12.92 * u;
}

// Convert SRGB[A] to RGB[A]
function $SRGB_to_RGB(color) {
    const result = {
        r: $SRGB_to_RGB_one_channel(color.r),
        g: $SRGB_to_RGB_one_channel(color.g),
        b: $SRGB_to_RGB_one_channel(color.b)
    };
                    
    if (color.a !== undefined) {
        result.a = color.a;
    }

    return result;    
}

// Convert RGB[A] to SRGB[A]
function $RGB_to_SRGB(color) {
    const result = {
        r: $RGB_to$SRGB_one_channel(color.r),
        g: $RGB_to$SRGB_one_channel(color.g),
        b: $RGB_to$SRGB_one_channel(color.b)
    };
                    
    if (color.a !== undefined) {
        result.a = color.a;
    }

    return result;    
}

// Color space conversion for RGB[A] to XYZ[A]. Note: *not* SRGB input!
// May go out of gamut. http://www.brucelindbloom.com/index.html?Eqn_RGB_to_XYZ.html
function $RGB_to_XYZ(color) {
    // Observer = 2°, Illuminant = D65
    const result = {
        x: color.r * 0.4124 + color.g * 0.3576 + color.b * 0.1805,
        y: color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722,
        z: color.r * 0.0193 + color.g * 0.1192 + color.b * 0.9505
    };

    if (color.a !== undefined) {
        result.a = color.a;
    }

    return result;
}

// Color space conversion for XYZ[A] to RGB[A]. Note: *not* SRGB output!
// May go out of gamut.
function $XYZ_to_RGB(color) {
    // Observer = 2°, Illuminant = D65
    const result = {
        r: color.x * 3.2406 + color.y * -1.5372 + color.z * -0.4986,
        g: color.x * -0.9689 + color.y * 1.8758 + color.z * 0.0415,
        b: color.x * 0.0557 + color.y * -0.204 + color.z * 1.057
    };

    if (color.a !== undefined) {
        result.a = color.a;
    }

    return result;
}

function $XYZ_to_LAsBs_one_channel(u) {
    return u > 0.008856 ? $Math.cbrt(u) : 7.787 * u + 16 / 116;
}

// XYZ[A] color to L A* B*[A] (where .as is the color channel and .a
// is the alpha channel) May go out of gamut. l is on the range [0, 100],
// as and bs are on the range [-100, 100]
function $XYZ_to_LAsBs(color) {
    const x = $XYZ_to_LAsBs_one_channel(color.x * (1 / 0.95047));
    const y = $XYZ_to_LAsBs_one_channel(color.y);
    const z = $XYZ_to_LAsBs_one_channel(color.z * (1 / 1.08883));

    // if (116 * y - 16 < 0) $error('Invalid input for XYZ');
    const result = {
        l: $Math.max(0, 116 * y - 16),
        as: 500 * (x - y),
        bs: 200 * (y - z)
    };
    
    if (color.a !== undefined) {
        result.a = color.a;
    }

    return result;
}

function $LAsBs_to_XYZ_one_channel(n) {
    return n > 0.206893034 ? (n * n * n) : (n - 16 / 116) * (1 / 7.787);
}

// L A* B*[A] to XYZ[A] color (where .as is the color channel and .a
// is the alpha channel) May go out of gamut.
function $LAsBs_to_XYZ(color) {
    const y = (color.l + 16) / 116;
    const x = color.as / 500 + y;
    const z = y - color.bs / 200;

    const result = {
        x: 0.95047 * $LAsBs_to_XYZ_one_channel(x),
        y: $LAsBs_to_XYZ_one_channel(y),
        z: 1.08883 * $LAsBs_to_XYZ_one_channel(z)
    };
    
    if (color.a !== undefined) {
        result.a = color.a;
    }

    return result;
}



function artist_hsv_to_rgb(h, s, v) {
    // Args version
    if (h.h !== undefined && s === undefined) {
        v = h.v;
        s = h.s;
        h = h.h;
    }

    s = CLAMP(s, 0, 1);
    
    h = loop(h, 0, 1);
    h = artist_hsv_to_rgb.$artist_hue(h);
    
    // Boost deep blue brightness
    const k = $Math.min($Math.abs(h - 0.68) * 10, 1);
    v *= 1 + s * 0.65 * (1 - k * k)
        
    return rgb({h: h, s: s, v: CLAMP(v, 0, 1)});
}

// Use RYB primaries and cheat the blue into cyan a little
// and spread the yellows
artist_hsv_to_rgb.$artist_hue = make_spline(
    // RYB hue:
    [0, 2/6, 3/6 - 0.02, 3/6 + 0.08, 4/6, 1],
    // RGB hue:
    [0, 1/6, 2/6 - 0.09, 2/6 + 0.15, 4/6 - 0.05, 1], 
    1, "clamp");




function perceptual_lerp_color(a, b, t) {
    let was_rgb = false;
    if (a.h === undefined && a.r !== undefined) {
        if (b.h !== undefined || b.r === undefined) { $error("perceptual_lerp_color() requires both colors to be rgb() or hsv()"); }
        // rgb case
        was_rgb = true;
        
    } else if (a.r === undefined && a.h !== undefined) {
        // hsv case
        if (b.r !== undefined || b.h === undefined) { $error("perceptual_lerp_color() requires both colors to be rgb() or hsv()"); }
        if (a.a !== undefined) {
            a = rgba(a);
            b = rgba(b);
        } else {
            a = rgb(a);
            b = rgb(b);
        }
    } else {
        $error("perceptual_lerp_color() requires both colors to be rgb() or hsv()");
    }

    a = $XYZ_to_LAsBs($RGB_to_XYZ($SRGB_to_RGB(a)));
    b = $XYZ_to_LAsBs($RGB_to_XYZ($SRGB_to_RGB(b)));
    let c = lerp(a, b, t);
    c = $RGB_to_SRGB($XYZ_to_RGB($LAsBs_to_XYZ(c)));

    c.r = $clamp(c.r, 0, 1);
    c.g = $clamp(c.g, 0, 1);
    c.b = $clamp(c.b, 0, 1);
    
    if (! was_rgb) {
        // Go back to HSV
        if (c.a !== undefined) {
            c = hsva(c);
        } else {
            c = hsv(c);
        }
    }
    
    return c;
}


function lerp(a, b, t, t_min, t_max) {
    if (t_max !== undefined) {
        // Five-argument version
        return lerp(a, b, (t - t_min) / (t_max - t_min));
    }
    
    // Test if these are numbers quickly using the presence of the toFixed method
    if (t === undefined || ! t.toFixed) { $error("The third argument to lerp must be a number"); }
    if (a.toFixed && b.toFixed) {
        return a + (b - a) * t;
    } else {
        const ta = typeof a, tb = typeof b;    
        if (! Array.isArray(a) && (tb === 'object') && (ta === 'object')) {
            // Handle some common cases efficiently without overloading and allocation.
            // The type checking is expensive but is much faster than not doing it.
            const ca = $Object.keys(a).length;
            const cb = $Object.keys(b).length;
            if (ca !== cb) { $error("The arguments to lerp must have the same number of elements"); }

            // xy()
            if (ca === 2 &&
                a.x !== undefined && a.y !== undefined &&
                b.x !== undefined && b.y !== undefined) {
                return {
                    x: a.x + (b.x - a.x) * t,
                    y: a.y + (b.y - a.y) * t
                };
            }

            // rgb()
            if (ca === 3 &&
                a.r !== undefined && a.g !== undefined && a.b !== undefined &&
                b.r !== undefined && b.g !== undefined && b.b !== undefined) {
                return {
                    r: a.r + (b.r - a.r) * t,
                    g: a.g + (b.g - a.g) * t,
                    b: a.b + (b.b - a.b) * t
                };
            }

            // rgba()
            if (ca === 4 &&
                a.r !== undefined && a.g !== undefined && a.b !== undefined && a.a !== undefined &&
                b.r !== undefined && b.g !== undefined && b.b !== undefined && b.a !== undefined) {
                return {
                    r: a.r + (b.r - a.r) * t,
                    g: a.g + (b.g - a.g) * t,
                    b: a.b + (b.b - a.b) * t,
                    a: a.a + (b.a - a.a) * t
                };
            }
        }

        return $add($mul(a, 1 - t), $mul(b, t));
    }
}


function linstep(start, end, t) {
    return $Math.max(0, $Math.min(1, (t - start) / (end - start)));
}


function smoothstep(start, end, t) {
    t = $Math.max(0, $Math.min(1, (t - start) / (end - start)));
    return t * t * (3 - 2 * t);
}


function smootherstep(start, end, t) {
    t = $Math.max(0, $Math.min(1, (t - start) / (end - start)));
    return t * t * t * (t * (t * 6 - 15) + 10);
}


function pow(a, b) {
    const ta = typeof a, tb = typeof b;
    if (ta === 'object') {
        let c = a.constructor ? a.constructor() : $Object.create(null);
        if (tb === 'number') {
            for (let key in a) c[key] = $Math.pow(a[key], b);
        } else {
            for (let key in a) c[key] = $Math.pow(a[key], b[key]);
        }
        return $Object.isFrozen(a) ? $Object.freeze(c) : c;
    } else if ((ta === 'number') && (tb === 'object')) {
        let c = b.constructor ? b.constructor() : Object.create(null);
        for (let key in b) c[key] = $Math.pow(a, b[key]);
        return $Object.isFrozen(a) ? $Object.freeze(c) : c;
    } else {
        return $Math.pow(a, b);
    }
}


function resized(str, n, pad, right_align) {
    n = $Math.max(n, 0);
    if (str.length === n) {
        return str;
    } else if (str.length < n) {
        if (right_align) {
            return str.padStart(n, pad);
        } else {
            return str.padEnd(n, pad);
        }
    } else if (right_align) { // shrink start
        const i = n - str.length;
        return str.substring(i, i + n + 1);
    } else { // shrink end
        return str.substring(0, n);
    }
}


function split(str, c, n) {
    if (c === undefined || c === '' || (is_number(c) && c <= 0)) {
        
        return Array.from(str);
        
    } else if (is_number(c)) {
        
        const array = [];
        c = $Math.min(c, str.length)
        const N = $Math.max(str.length / c);
        for (let i = 0; i < N; ++i) {
            const j = c * i;
            array.push(str.slice(j, j + c));
        }
        return array;
            
    } else if (n !== undefined) {

        if (n <= 0) {
            return [str];
        } else {
            const result = [];
            let i = str.indexOf(c);
            while (n > 0 && str.length > 0 && i >= 0) {
                result.push(str.substring(0, i));
                str = str.substring(i + c.length);
                --n;
            }
            
            if (str.length > 0) {
                result.push(str);
            }
            
            return result;
        }
        
    } else {
        
        return str.split(c);
        
    }
}


// default_value is deprecated...use `default` now
function load_local(key, default_value) {
    let table = $window.localStorage.getItem('GAME_STATE_' + $gameURL);
    if (! table) { return default_value; }
    
    table = JSON.parse(table);

    if (arguments.length === 0) {
        // Return everything
        for (let key in table) {
            table[key] = parse(table[key]);
        }
        return table;
    } else {
        const value = table[key];
        if (value) {
            return parse(value);
        } else {
            return default_value;
        }
    }
}


function save_local(key, value) {
    if (arguments.length === 0) {
        $setLocalStorage('GAME_STATE_' + $gameURL, '{}');
        return;
    }

    if (typeof key === 'object') {
        for (let k in key) {
            save_local(k, key[k]);
        }
        return;
    }
    
    let table = $getLocalStorage('GAME_STATE_' + $gameURL);
    
    if (table) {
        table = JSON.parse(table);
    } else {
        table = {};
    }

    if (value === undefined) {
        delete table[key];
    } else {
        const v = unparse(value, 0);
        if (v.length > 4096) {
            $error('Cannot store_local() a value that is greater than 4096 characters after unparse()');
        }
        table[key] = v;
        if ($Object.keys(table).length > 64) {
            $error('Cannot store_local() more than 64 separate keys.');
        }
    }

    $setLocalStorage('GAME_STATE_' + $gameURL, JSON.stringify(table));
}


function play_sound(sound, loop, volume, pan, pitch, time, rate, stopped) {
    if (sound.sound && (arguments.length === 1)) {
        // Object version
        loop    = sound.loop;
        volume  = sound.volume;
        pan     = sound.pan;
        pitch   = sound.pitch;
        time    = sound.time;
        rate    = sound.playback_rate;
        stopped = sound.stopped;
        sound   = sound.sound;
    }

    if (pan && (pan.x !== undefined) && (pan.y !== undefined)) {
        // Positional sound
        pan = transform_cs_to_ss(transform_ws_to_cs(pan));
        pan = $clamp((2 * pan.x / SCREEN_SIZE.x) - 1, -1, 1);
    }

    return $play_sound(sound, loop, volume, pan, pitch, time, rate, stopped);
}


function set_pan(audio, pan) {
    if (pan && pan.x !== undefined && pan.y !== undefined) {
        // Positional sound
        pan = transform_cs_to_ss(transform_ws_to_cs(pan));
        pan = $clamp((2 * pan.x / SCREEN_SIZE.x) - 1, -1, 1);
    }
    
    $set_pan(audio, pan);
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
function find_path(start, goal, costEstimator, edgeCost, getNeighbors, nodeToID, map) {
    if (start === undefined) { $error('The start_node argument to find_path() must not be nil'); }
    if (goal === undefined) { $error('The goal_node argument to find_path() must not be nil'); }
    if (typeof costEstimator !== 'function') { $error('The estimate_path_cost() argument to find_path() must be a function'); }
    if (typeof getNeighbors !== 'function') { $error('The get_neighbors() argument to find_path() must be a function'); }
    if (typeof edgeCost !== 'function') { $error('The edge_cost() argument to find_path() must be a function'); }
    if (typeof nodeToID !== 'function') { $error('The node_to_ID() argument to find_path() must be a function'); }
    
    // Paths encoded by their last Step paired with expected shortest
    // distance
    const queue = new $PriorityQueue();
    
    // Maps each Node to the Step on the best known path to that Node.
    const bestPathTo = new Map();

    let shortest = new $Step(start, 0, costEstimator(start, goal, map));
    bestPathTo.set(nodeToID(start, map), shortest);
    queue.insert(shortest, shortest.cost());

    const goalID = nodeToID(goal, map);

    while (queue.length() > 0) {
        shortest = queue.removeMin();
        shortest.inQueue = false;

        // Last node on the shortest path
        const P = shortest.last;

        const node_id = nodeToID(P, map);
        if (node_id === undefined) {
            $error('node_to_id() returned nil in find_path()');
        }
        
        if (node_id === goalID) {
            // We're done.  Generate the path to the goal by retracing steps
            const path = [goal];

            // Construct the path backwards
            while (shortest.previous) {
                shortest = bestPathTo.get(nodeToID(shortest.previous, map));
                path.push(shortest.last);
            }
            return path.reverse();
        }

        // Consider all neighbors of P (that are still in the queue
        // for consideration)
        const neighbors = getNeighbors(P, map);
        if (! Array.isArray(neighbors)) { $error('The get_neighbors() function passed to find_path() must return an array of nodes. Received: ' + unparse(neighbors)); }
        for (let i = 0; i < neighbors.length; ++i) {
            const N = neighbors[i];
            if (N === undefined) { $error('get_neighbors() returned an array containing nil node in find_path().'); }
            const id = nodeToID(N, map);
            if (id === undefined) {
                $error('node_to_id() returned nil in find_path()');
            }
            const cost = edgeCost(P, N, map);
            if (typeof cost !== 'number' || cost < 0) { $error('edge_cost() must return a non-negative number. Received: ' + unparse(cost)); }
            
            if (cost < Infinity) {
                const newCostFromStart = shortest.costFromStart + cost;
            
                // Find the current-best known way to N (or create it, if there isn't one)
                let oldBestToN = bestPathTo.get(id);
                if (oldBestToN === undefined) {
                    // Create an expensive dummy path that will immediately be overwritten
                    oldBestToN = new $Step(N, Infinity, costEstimator(N, goal, map));
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


/* Computes the convex hull of an array of points using the monotone
   chain algorithm (Andrew 1979). This is O(n lg n) and slightly more robust than
   Graham Scan by avoiding angle computations. The points are returned
   in CCW order. The points themselves are only shallow cloned, so
   will be the same objects that were in vertex_array. */
function convex_hull(vertex_array) {
    // 2D cross product of (A-P) x (B-P)
    function orient(P, A, B) {
        return (A.x - P.x) * (B.y - P.y) - (A.y - P.y) * (B.x - P.x);
    }
    
    const N = vertex_array.length;

    if (N <= 1) {
        // Point: return it
        return clone(vertex_array);
    } else if (N === 2) {
        // Line, which may be degenerate
        if (vertex_array[0].x === vertex_array[1].x &&
            vertex_array[0].y === vertex_array[1].y) {

            // Degenerate
            return [vertex_array[0]];
        } else {
            return clone(vertex_array);
        }
    }

    // Below here we have at least a triangle, which may be degenerate

    // Sort along the x-axis, using the y-axis to resolve ties
    vertex_array = sorted(vertex_array, function(a, b) {
        const dx = a.x - b.x;
        if (dx !== 0) {
            return dx;
        } else {
            return a.y - b.y;
        }
    });

    const result = new Array(2 * N);
    let k = 0;
  
    // Build lower hull
    for (let i = 0; i < N; ++i) {
 
        // If the point at K-1 position is not a part
        // of hull as vector from ans[k-2] to ans[k-1] 
        // and ans[k-2] to A[i] has a clockwise turn
        while (k >= 2 && orient(result[k - 2], result[k - 1], vertex_array[i]) <= 0) {
            --k;
        }
        result[k++] = vertex_array[i];
    }
 
    // Build upper hull
    for (let i = N - 1, t = k + 1; i > 0; --i) {
        // If the point at K-1 position is not a part
        // of hull as vector from result[k-2] to result[k-1] 
        // and result[k-2] to A[i] has a clockwise turn
        while (k >= t && orient(result[k - 2], result[k - 1], vertex_array[i - 1]) <= 0) {
            --k;
        }
        result[k++] = vertex_array[i - 1];
    }
 
    result.length = k - 1;
 
    return result;
}

///////////////////////////////////////////////////////////////////////////////

var $Function = $Object.getPrototypeOf(function(){}).constructor;

/** Creates a new function from code *in this environment*, so that
    it has this scope and cannot escape. Invoke next() repeatedly on
    the returned object to execute it. */
function $makeCoroutine(code) {
    return new $Function(code)();
}


////////////////////////////////////////////////////////////////////////////////////////
//                 Software rendering implementation of the Host API                  //
////////////////////////////////////////////////////////////////////////////////////////

function set_screen_size(size, private_views) {
    if (private_views === undefined) {
        private_views = false;
    }

    if (! size || size.x === undefined) {
        $error('The first argument to set_screen_size() must be an xy()');
    }

    let w = $Math.round(size.x) | 0;
    let h = $Math.round(size.y) | 0;

    // Check for legal resolutions
    if (private_views) {
        if (! ((w === 768 && h === 448 && $feature_768x448) || (w === 640 && h === 360) || (w === 384 && h === 224) || (w === 128 && h === 128))) {
            $error('set_screen_size() with private views must be at 640x360, 384x224, or 128x128 resolution');
        }
    } else if (! ((w === 640 && h === 360) ||
                  (w === 384 && h === 224) ||
                  (w === 320 && h === 180) ||
                  (w === 192 && h === 112) ||
                  (w === 128 && h === 128) ||
                  (w ===  64 && h ===  64) ||
                  $feature_custom_resolution)) {
        $error('Illegal resolution for set_screen_size(): xy(' + w + ', ' + h + ')');
    }

    // Clear the current and previous draw call stack, which
    // may not be clipped properly to the screen
    $previousGraphicsCommandList.length = 0;
    $graphicsCommandList.length = 0;

    // Change the frame buffer size and rebind the
    // resolution constants
    $setFramebufferSize(w, h, private_views);

    // Reset the transformations
    reset_camera();
    reset_transform();
    reset_clip();
}


function get_mode() {
    return $gameMode;
}

function get_previous_mode() {
    return $prevMode;
}


var $lastBecause = ''
function because(reason) {
    $lastBecause = reason;
}

function push_mode(mode, ...args) {
    $verifyLegalMode(mode);

    // Push the stacks
    $previousModeGraphicsCommandListStack.push($previousModeGraphicsCommandList);
    $mode_framesStack.push(mode_frames);
    $modeStack.push($gameMode);
    $prevModeStack.push($prevMode);

    mode_frames = -1;
    $skipGraphics = false;
    $prevMode = $gameMode;
    $gameMode = mode;
    
    $previousModeGraphicsCommandList = $previousGraphicsCommandList;

    // Reset the graphics
    $graphicsCommandList = [];
    $previousGraphicsCommandList = [];

    if (mode.$name[0] !== '$') {
        $systemPrint('Pushing into mode ' + mode.$name + ($lastBecause ? ' because "' + $lastBecause + '"' : ''));
    }

    // Run the enter callback on the new mode
    $iteratorCount = new WeakMap();
    $gameMode.$enter.apply(null, args);

    $updateHostCodeCopyRuntimeDialogVisiblity();
    throw {nextMode: mode};
}


function quit_game() {
    $systemPrint('Quitting the game' + ($lastBecause ? ' because "' + $lastBecause + '"' : ''));
    throw {quit_game:1};
}


function launch_game(url) {
    $systemPrint('Launching ' + url + ($lastBecause ? ' because "' + $lastBecause + '"' : ''));
    throw {launch_game:url};
}


function reset_game() {
    $systemPrint('Resetting the game' + ($lastBecause ? ' because "' + $lastBecause + '"' : ''));
    throw {reset_game:1};
}

/* Called by games from the runtime to force the local player into the 
   system menu for online */
function push_guest_menu_mode() {
    push_mode(push_guest_menu_mode.$OnlineMenu, undefined, true);
}

function pop_mode(...args) {
    if ($modeStack.length === 0) { $error('Cannot pop_mode() from a mode entered by set_mode()'); }

    // Run the leave callback on the current mode
    let old = $gameMode;
    $prevMode = $prevModeStack.pop();

    // Pop the stacks
    $previousGraphicsCommandList = $previousModeGraphicsCommandList;
    $previousModeGraphicsCommandList = $previousModeGraphicsCommandListStack.pop();
    $gameMode = $modeStack.pop();
    mode_frames = $mode_framesStack.pop();
    $skipGraphics = false;

    $iteratorCount = new WeakMap();
    old.$leave();

    // Reset the graphics
    $graphicsCommandList = [];
    
    if ($gameMode.$name[0] !== '$') {
        $systemPrint('Popping back to mode ' + $gameMode.$name + ($lastBecause ? ' because "' + $lastBecause + '"' : ''));
    }

    // Run the pop_mode event on $gameMode if it exists
    let eventName = '$pop_modeFrom' + old.$name;
    if ($gameMode[eventName] !== undefined) {
        // repeat here so that the "this" is set correctly to $gameMode
        $iteratorCount = new WeakMap();
        $gameMode[eventName](...args);
    }

    $updateHostCodeCopyRuntimeDialogVisiblity();
    throw {nextMode: $gameMode};
}


function set_mode(mode, ...args) {
    $verifyLegalMode(mode);
    
    // Erase the stacks
    $previousModeGraphicsCommandListStack = [];
    $mode_framesStack = [];
    $modeStack = [];
    $prevModeStack = [];

    // Set up the new mode
    $prevMode = $gameMode;
    $gameMode = mode;

    // Loop nesting is irrelvant, since we're about to leave
    // that scope permanently.
    $iteratorCount = new WeakMap();
    
    // Run the leave callback on the current mode
    if ($prevMode) { $prevMode.$leave(); }
    
    mode_frames = 0;
    $skipGraphics = false;

    // Save the previous graphics list for draw_previous_mode()
    $previousModeGraphicsCommandList = $previousGraphicsCommandList;

    // Reset the graphics
    $graphicsCommandList = [];
    $previousGraphicsCommandList = [];

    if (mode.$name[0] !== '$') {
        $systemPrint('Entering mode ' + mode.$name + ($lastBecause ? ' because "' + $lastBecause + '"' : ''));
    }
    
    // Run the enter callback on the new mode
    $iteratorCount = new WeakMap();
    if ($gameMode.$enter) { $gameMode.$enter.apply(null, args); }

    $updateHostCodeCopyRuntimeDialogVisiblity();
    throw {nextMode: mode};
}


function $verifyLegalMode(mode) {
    try {
        // The test itself can throw, so we wrap it in an exception handler.

        // The name is 'GeneratorFunction' here without a prefix because it is
        // referencing JavaScript's own GeneratorFunction, not ours.

        if (mode.$type !== 'mode') {
            throw 1;
        }
    } catch (e) {
        $error('Not a valid mode: ' + unparse(mode));
    }
}


function now() {
    return $performance.now() * 0.001;
}


function local_time(args) {
    
    let d;
    if (args === undefined) {
        d = new Date();
    } else if (typeof args === 'string') {
        d = new Date(args);
    } else {
        d = new Date(args.year, args.month, args.day,
                     args.hour || 0, args.minute || 0, args.second || 0,
                     args.millisecond || 0);

        // Modify the date to adjust for the timezone
        d = new Date(d.getTime() + (new Date().getTimezoneOffset() - args.timezone) * 60000);
    }
    
    return {
        year:        d.getFullYear(),
        month:       d.getMonth(),
        day:         d.getDate(),
        hour:        d.getHours(),
        minute:      d.getMinutes(),
        second:      d.getSeconds(),
        millisecond: d.getMilliseconds(),
        weekday:     d.getDay(),
        day_second:  (d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds() + d.getMilliseconds() * 0.001,
        timezone:    d.getTimezoneOffset(),
        absolute_milliseconds: d.getTime()
    };
}


/**
   Called on virtual CPU to initiate virtual GPU work from the emitted
   PyxlScript code. The compiler directly produces the calls to this
   within a Mode::frame()
*/
function $show() {
    const startTime = performance.now();
    
    // Check whether this frame will be shown or not, if running below
    // frame rate and pruning graphics.  Use mode_frames instead of
    // game_frames to ensure that frame 0 is always rendered for a mode.
    if (mode_frames % $graphicsPeriod === 0) {
        if ($onScreenHUDEnabled) {
            // Submit diagnostics HUD as additional graphics calls
            $onScreenDrawBarGraph('Frame:', $onScreenHUDDisplay.time.frame, 0xFA5F, 0);
            $onScreenDrawBarGraph('  60fps Logic:', $onScreenHUDDisplay.time.logic, 0xFFA0, 1);
            $onScreenDrawBarGraph('  ' + $onScreenHUDDisplay.time.refresh + 'fps Graphics:', $onScreenHUDDisplay.time.graphics, $THREADED_GPU ? 0xF0DE : 0xF0D0, 2);
            if ($onScreenHUDDisplay.time.physics > 0) {
                $onScreenDrawBarGraph('  60fps Physics:', $onScreenHUDDisplay.time.physics, 0xF0AF, 3);
            }
            if ($THREADED_GPU) {
                $onScreenDrawBarGraph('  ' + $onScreenHUDDisplay.time.refresh + 'fps GPU:', $onScreenHUDDisplay.time.gpu, 0xF0D0, 4);
            }
            if ($onScreenHUDDisplay.time.browser > 0) {
                $onScreenDrawBarGraph('  Browser:', $onScreenHUDDisplay.time.browser, 0xFAAA, 5);
            }
        }
        
        const backgroundSpritesheetIndex = $background.spritesheet ? $background.spritesheet.$index[0] : undefined;
        const backgroundColor16 = $background.spritesheet ? 0 : (($colorToUint16($background) >>> 0) | 0xf000);

        const args = [$graphicsCommandList, backgroundSpritesheetIndex, backgroundColor16];
                
        if ($GPU) {
            if (! $updateImageData32) {
                ++$missedFrames;
                console.log('Virtual GPU busy, skipping. mode_frames =', mode_frames);
            } else {
                
                // Transfer the updateImageData
                // console.log('Transferring updateImageData to GPU thread');
                console.assert($updateImageData32);
                
                $GPU.postMessage(
                    {
                        type: 'gpu_execute',
                        args: args,
                        updateImageData: $updateImageData,
                        updateImageData32: $updateImageData32
                    },
                    [$updateImageData32.buffer]);
                
                $updateImageData = null;
                $updateImageData32 = null;
            }
        } else {
            $gpu_execute(...args);
        }
    }
    
    // Save for draw_previous_frame()
    $previousGraphicsCommandList = $graphicsCommandList;
    
    // Clear draw list (regardless of whether it is actually drawn)
    $graphicsCommandList = [];

    // Includes submitFrame() time for non-threaded GPU
    $graphicsTime = performance.now() - startTime;
    
    $requestInput();

    ++game_frames;
    ++mode_frames;
}


/** Updates the z value with an epsilon and stores the current set_clipping region */
function $addGraphicsCommand(cmd) {
    if (is_nan(cmd.z)) { $error('NaN z value in graphics command'); }
    
    cmd.clipX1 = $clipX1;
    cmd.clipY1 = $clipY1;
    cmd.clipX2 = $clipX2;
    cmd.clipY2 = $clipY2;

    // Offset subsequent commands to get a unique z value for each,
    // and stable sort ordering. The offset value must be orders of
    // magnitude less than the quadplay epsilon value to avoid
    // confusion for programmers with z ordering.
    cmd.z     += $graphicsCommandList.length * $Math.sign($scaleZ) * 1e-10;
    
    $graphicsCommandList.push(cmd);
}
