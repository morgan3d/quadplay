/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */

'use strict';

////////////////////////////////////////////////////////////////////////////////////////////
//
// Mobile touch and virtual button support
//
// Because a touch end for *one* finger could occur for an element
// that still has another finger holding it down, we have to track
// all active touches and synthesize events for them rather than
// simply execute the mouse handlers directly. We also can't allow
// the mouse handers to *automatically* fire, since they run at a
// 300 ms delay on mobile.

// For use when processing buttons
const emulatorButtonArray = Array.from(document.getElementsByClassName('emulatorButton'));
const deadZoneArray = Array.from(document.getElementsByClassName('deadZone'));

// Maps touch.identifiers to objects with x and y members
const activeTouchTracker = {};

/* event must have clientX and clientY */
function inElement(event, element) {
    const rect = element.getBoundingClientRect();
    if (element.style.transform === 'rotate(45deg)') {
        // Assume symmetrical
        const centerX = rect.left + rect.width * 0.5;
        const centerY = rect.top + rect.height * 0.5;
        return Math.abs(centerX - event.clientX) + Math.abs(centerY - event.clientY) < rect.width * 0.5;
    } else {
        return (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
    }
}


function onTouchStartOrMove(event) {
    wake();
    updateLastInteractionTime();
    for (let i = 0; i < event.changedTouches.length; ++i) {
        const touch = event.changedTouches[i];
        let tracker = activeTouchTracker[touch.identifier];

        const screen_coord = emulatorScreenEventCoordToQuadplayScreenCoord(touch);
        if (event.target === emulatorScreen || event.target === overlayScreen || event.target === afterglowScreen) {

            if (! tracker ||
                !(tracker.lastTarget === emulatorScreen || tracker.lastTarget === overlayScreen || tracker.lastTarget === afterglowScreen)) {
                // New touch
                QRuntime.touch.aa = (! QRuntime.touch.a) ? 1 : 0;
                QRuntime.touch.pressed_a = QRuntime.touch.aa;
                QRuntime.touch.a = 1;
                QRuntime.touch.screen_dx = 0;
                QRuntime.touch.screen_dy = 0;
            } else {
                // Continued touch
                QRuntime.touch.screen_dx = screen_coord.x - QRuntime.touch.screen_x;
                QRuntime.touch.screen_dy = screen_coord.y - QRuntime.touch.screen_y;
            }
            
            QRuntime.touch.screen_x = screen_coord.x;
            QRuntime.touch.screen_y = screen_coord.y;
            
            if (QRuntime.touch.aa && document.getElementById('printTouchEnabled').checked) {
                $systemPrint(`\ntouch.screen_xy = xy(${QRuntime.touch.screen_x}, ${QRuntime.touch.screen_y})`);

                // Read the 32-bit color from the screen
                const C = updateImageData32[Math.floor(QRuntime.touch.screen_y) * SCREEN_WIDTH + Math.floor(QRuntime.touch.screen_x)];
                const r = (C >> 4) & 0xf, g = (C >> 12) & 0xf, b = (C >> 20) & 0xf;
                const hex_color = `#${r.toString(16)}${g.toString(16)}${b.toString(16)}`.toUpperCase();
                $outputAppend(`<i>rgb(${Math.round(100 * r / 15)}%, ${Math.round(100 * g / 15)}%, ${Math.round(100 * b / 15)}%) <div style="width: 32px; height: 12px; display: inline-block; position: relative; top: 2px; background: ${hex_color}"></div> ${hex_color}</i><br>`);
            }
        }

        if (tracker &&
            (tracker.lastTarget === emulatorScreen || tracker.lastTarget === overlayScreen || tracker.lastTarget === afterglowScreen) &&
            (event.target !== emulatorScreen && event.target !== overlayScreen && event.target !== afterglowScreen)) {
            // Lost contact with screen
            QRuntime.touch.a = 0;
            QRuntime.touch.released_a = 1;
        }

        if (! tracker) {
            tracker = activeTouchTracker[touch.identifier] = {identifier: touch.identifier, screen_coord: {x:0, y:0}};
        }

        if (event.target === emulatorScreen || event.target === overlayScreen || event.target === afterglowScreen) {
            tracker.screen_x = screen_coord.x;
            tracker.screen_y = screen_coord.y;
        }

        tracker.clientX = touch.clientX;
        tracker.clientY = touch.clientY;
        tracker.lastTarget = event.target;
    }

    onTouchesChanged(event);

    if ((event.target === emulatorScreen || event.target === overlayScreen) || (event.target.className === 'emulatorButton')) {
        // Prevent default browser handling on virtual controller buttons
        event.preventDefault();
        event.stopPropagation();
        event.cancelBubble = true;
    }

    return false;
}


function onTouchEndOrCancel(event) {
    // Add the new touches
    for (let i = 0; i < event.changedTouches.length; ++i) {
        const touch = event.changedTouches[i];
        const tracker = activeTouchTracker[touch.identifier];
        
        // The tracker *should* be found, but check defensively
        // against weird event delivery
        if (tracker) {
            if (tracker.lastTarget === emulatorScreen || tracker.lastTarget === overlayScreen || tracker.lastTarget === afterglowScreen) {
                // Lost contact with screen
                QRuntime.touch.a = 0;
                QRuntime.touch.released_a = 1;
            }
            
            // Delete is relatively slow (https://jsperf.com/delete-vs-undefined-vs-null/16),
            // but there are far more move events than end events and the table is more
            // convenient and faster for processing move events than an array.
            delete activeTouchTracker[touch.identifier];            
        }
    }
    
    onTouchesChanged(event);
    return false;
}

/* Processes all emulatorButtons against the activeTouchTracker. If
   any *changed* touch was currently over a button, cancels the event. */
function onTouchesChanged(event) {
    // Do not process buttons when they aren't visible
    if (uiMode !== 'Emulator') { return; }
    
    // Latch state
    for (let j = 0; j < emulatorButtonArray.length; ++j) {
        const button = emulatorButtonArray[j];
        button.wasPressed = button.currentlyPressed || false;
        button.currentlyPressed = false;
    }
    
    // Processes all touches to see what is currently pressed
    for (let t in activeTouchTracker) {
        const touch = activeTouchTracker[t];
        let touchPressed = true;

        // Test against dead zone
        for (let j = 0; j < deadZoneArray.length; ++j) {
            if (inElement(touch, deadZoneArray[j])) {
                touchPressed = false;
                break;
            }
        }

        // Process all buttons
        for (let j = 0; j < emulatorButtonArray.length; ++j) {
            const button = emulatorButtonArray[j];
            button.currentlyPressed = button.currentlyPressed ||
                (inElement(touch, button) && touchPressed);
        }
    }

    // Now see which buttons differ from their previous state
    for (let j = 0; j < emulatorButtonArray.length; ++j) {
        const button = emulatorButtonArray[j];
        if (button.wasPressed !== button.currentlyPressed) {
            // This button's state changed
            const buttonCode = button.id.substring(0, button.id.length - 'button'.length);

            // Fake a keyboard event
            const fakeEvent = {code: buttonCode, stopPropagation:Math.abs, preventDefault:Math.abs}
            
            if (button.currentlyPressed) {
                onEmulatorKeyDown(fakeEvent);
                emulatorButtonState[buttonCode] = 1;
            } else {
                onEmulatorKeyUp(fakeEvent);
                emulatorButtonState[buttonCode] = 0;
            }
        }
    }

    // See if this event was in any of the buttons (including on and
    // end event, where it will not be in the touch list) and then
    // prevent/stop that event so that we don't get a synthetic mouse event
    // or scroll.
    for (let i = 0; i < event.changedTouches.length; ++i) {
        let touch = event.changedTouches[i];
        for (let j = 0; j < emulatorButtonArray.length; ++j) {
            if (inElement(touch, emulatorButtonArray[j])) {
                event.preventDefault();
                event.stopPropagation();
                break;
            }
        }
    }
}

const fakeMouseEvent = {
    changedTouches: [{identifier:-1, clientX: 0, clientY:0}],
    realEvent: null,
    preventDefault: function() { this.realEvent.preventDefault(); },
    stopPropagation: function() { this.realEvent.stopPropagation(); this.realEvent.cancelBubble = true; },
};

function emulatorScreenEventCoordToQuadplayScreenCoord(event) {
    const rect = emulatorScreen.getBoundingClientRect();
    
    let zoom = 1;
    if (isSafari) {
        zoom = parseFloat(document.getElementById('screenBorder').style.zoom || '1');
    }

    return {x: clamp(Math.floor(emulatorScreen.width  * (event.clientX - rect.left * zoom) / (rect.width * zoom)), 0, emulatorScreen.width  - 1) - 0.5,
            y: clamp(Math.floor(emulatorScreen.height * (event.clientY - rect.top  * zoom) / (rect.height * zoom)), 0, emulatorScreen.height - 1) - 0.5};
}

const mouse = {screen_x: 0, screen_y: 0, screen_x_prev: 0, screen_y_prev: 0, buttons: 0, movement_movement: false};

function updateMouseDevice(event) {
    if (event.target === emulatorScreen || event.target === overlayScreen) {
        const coord = emulatorScreenEventCoordToQuadplayScreenCoord(event);
        mouse.screen_x = coord.x;
        mouse.screen_y = coord.y;

        if (event.movementX !== undefined) {
            const rect = emulatorScreen.getBoundingClientRect();

            let zoom = 1;
            if (isSafari) {
                zoom = parseFloat(document.getElementById('screenBorder').style.zoom || '1');
            }

            if (mouse.movement_x === undefined) {
                mouse.movement_x = mouse.movement_y = 0;
            }

            // Movement events are available on this browser. They are higher precision and
            // survive pointer lock, so report them instead. These must be ACCUMULATED because
            // they arrive at the monitor's refresh rate, not the game's refresh rate. On
            // high framerate monitors we need to know the total of all mouse events. These
            // are zeroed again in the main game loop.            
            mouse.movement_x += emulatorScreen.width  * event.movementX / (rect.width  * zoom);
            mouse.movement_y += emulatorScreen.height * event.movementY / (rect.height * zoom);
            mouse.movement = true;
        }
    }
    mouse.buttons = event.buttons;
}


function onMouseDownOrMove(event) {
    updateMouseDevice(event);
    // Allow mouse movement to prevent sleep, but not to wake
    updateLastInteractionTime();
    
    if (event.buttons !== 0) {
        // Do not wake on mouse movement, only buttons
        wake();

        // Synthesize a fake touch event (which will then get turned
        // into a fake key event!)
        fakeMouseEvent.changedTouches[0].clientX = event.clientX;
        fakeMouseEvent.changedTouches[0].clientY = event.clientY;
        fakeMouseEvent.realEvent = event;
        fakeMouseEvent.target = event.target;
        return onTouchStartOrMove(fakeMouseEvent);
    }
}


function onMouseUpOrMove(event) {
    updateMouseDevice(event);
    // Synthesize a fake touch event (which will then get turned
    // into a fake key event!)
    fakeMouseEvent.changedTouches[0].clientX = event.clientX;
    fakeMouseEvent.changedTouches[0].clientY = event.clientY;
    fakeMouseEvent.realEvent = event;
    fakeMouseEvent.target = event.target;
    return onTouchEndOrCancel(fakeMouseEvent);
}


/* quadplay-host is loaded before quadplay.js, so we put this initialization in a callback. */
function initializeBrowserEmulator() {
    // Prevent hitches for touch event handling on Android Chrome
    // https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#Improving_scrolling_performance_with_passive_listeners
    const options = {passive: false, capture: true};
    document.addEventListener('mousedown',   onMouseDownOrMove, options);
    document.addEventListener('mousemove',   onMouseDownOrMove, options);
    document.addEventListener('mouseup',     onMouseUpOrMove, options);
    document.addEventListener('touchstart',  onTouchStartOrMove, options);
    document.addEventListener('touchmove',   onTouchStartOrMove, options);
    document.addEventListener('touchend',    onTouchEndOrCancel, options);
    document.addEventListener('touchcancel', onTouchEndOrCancel, options);
}
