/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License*/
"use strict";

// Mapped to QRuntime.midi
const midi = Object.freeze({
    $options: {sysex: false, software: true, access: undefined},
    
    input_port_table: {},
    input_port_array: [],

    output_port_table: {},
    output_port_array: [],
    
    // Reset every frame. The messages are in the order received.
    message_queue: []
});


/** Reset state, so that MIDI cannot be used again until the request succeeds */
function midiReset() {
    if (midi.$options.midiAccess) { midi.$options.midiAccess.onstatechange = undefined; }

    // Remove event handlers
    for (const port of midi.input_port_array) {
        port.$port.onmidimessage = undefined;
    }
    
    midi.message_queue.length = 0;
    midi.input_port_array.length = 0;
    midi.output_port_array.length = 0;
    Object.keys(midi.input_port_table).forEach(key => delete midi.input_port_table[key]);
    Object.keys(midi.output_port_table).forEach(key => delete midi.output_port_table[key]);
}

/*
 See also https://www.songstuff.com/recording/article/midi_message_format/
 */
function onMIDIMessage(message) {
    message.stopPropagation();
    const port = midi.input_port_table[message.target.name + message.target.id];
    
    const status = message.data[0];
    const data1 = message.data[1];
    
    // A velocity value might not be included with a noteOff command
    const data2 = (message.data.length > 2) ? message.data[2] : 0;

    const combined_data = (data2 << 7) + data1;
    
    const outmessage = {
        port: port,
        raw: [...message.data]
    };

    switch (status) {
    case 0xF0: // sysex start
        outmessage.type = "SYSEX_START";
        outmessage.manufacturer = data1;
        outmessage.data = data2;
        break;

    case 0xF1: // time code
        outmessage.type = "TIME";
        outmessage.data = data1;

    case 0xF2: // song pointer
        outmessage.type = "SONG_POINTER";
        outmessage.data = combined_data;
        break;

    case 0xF3: // song select
        outmessage.type = "SONG_SELECT";
        outmessage.song = data1;
        break;

    case 0xF6: // tune request
        outmessage.type = "TUNE";
        break;

    case 0xF7:
        outmessage.type = "SYSEX_END";
        break;

    case 0xF8:
        outmessage.type = "TIMING_CLOCK";
        break;

    case 0xF9:
        outmessage.type = "MEASURE_END";
        break;

    case 0xFA:
        outmessage.type = "START";
        break;
        
    case 0xFB:
        outmessage.type = "CONTINUE";
        break;

    case 0xFC:
        outmessage.type = "STOP";
        break;

    case 0xFE:
        outmessage.type = "ACTIVE_SENSING";
        break;

    case 0xFF:
        outmessage.type = "RESET";
        break;

    default:
        {
            // Allow MIDI to keep quadplay awake
            updateLastInteractionTime();
            const type = status >> 4;
            outmessage.channel = status & 0x0f;
            
            switch (type) {
            case 0x8:
                outmessage.type = "NOTE_OFF";
                outmessage.note = data1;
                break;

            case 0x9:
                outmessage.type = "NOTE_ON";
                outmessage.note = data1;
                outmessage.velocity = data2;
                break;
                
            case 0xA: // aftertouch
                outmessage.type = "POLYPHONIC_AFTERTOUCH";
                outmessage.note = data1;
                outmessage.pressure = data2;
                break;
                
            case 0xB: // control change
                outmessage.type = "CONTROL_CHANGE";
                outmessage.controller = data1;
                outmessage.data = data2;
                break;

            case 0xC: // program change
                outmessage.type = "PROGRAM_CHANGE";
                outmessage.program = data1;
                break;
                
            case 0xD: // channel aftertouch
                outmessage.type = "CHANNEL_AFTERTOUCH";
                outmessage.pressure = data1;
                break;
                
            case 0xE: // pitch wheel
                outmessage.type = "PITCH_WHEEL";
                outmessage.data = combined_data;
                break;
            }
        } // channel messages
    } // switch status
    
    Object.freeze(outmessage);
    midi.message_queue.push(outmessage);

    // console.log(outmessage);

    // If the game is not running, immediately process the queue so
    // that port note state is up to date when the game resumes/starts,
    // but the message queue is not backing up.
    if (emulatorMode !== 'play') {
        midiBeforeFrame();
        midiAfterFrame();
    }
}


function onMIDIInitSuccess(midiAccess) {
    console.log('MIDI: Initialize success');

    function makeChannel() {
        const channel = {
            $note_active: false,
            $controller_active: false,
            note: new Array(128),
            controller: new Array(128)
        };
        
        for (let i = 0; i < 128; ++i) {
            channel.note[i] = Object.seal({on: 0, pressed: 0, released: 0, velocity: 0, pressure: 0});
            channel.controller[i] = Object.seal({value: 0, delta: 0});
        }

        Object.seal(channel.note);
        Object.seal(channel.controller);
        
        return channel;
    }
    
    function addPort(port) {
        const visible_port = {
            $name: `midi.${port.type === 'input' ? 'in' : 'out'}put_port_table["${port.name + port.id}"]`,
            $port: port,
            name: port.name,
            id: port.id,
            state: port.state,
            manufacturer: port.manufacturer,
            type: port.type,
            ...(port.type === 'input' ? makeChannel() : {})
        };
        
        if (port.type === 'input') {
            if (midi.input_port_table[port.name + port.id]) {
                // Already present
                console.log('MIDI Warning: ignored repeated add of MIDI ' + port.type + ' port ' + port.name);
                return;
            }

            visible_port.channel = new Array(16);
            for (let i = 0; i < 16; ++i) {
                visible_port.channel[i] = makeChannel();
            }
            //Object.seal(visible_port.channel);
            //Object.seal(visible_port);
            midi.input_port_table[port.name + port.id] = visible_port;
            midi.input_port_array.push(visible_port);

            // This triggers a statechange event on MIDIAccess.
            // Sometimes the message handler is already present
            // on a reconnection
            console.log('Adding midimessage handler');
            //console.assert(! port.onmidimessage);
            port.onmidimessage = onMIDIMessage;

        } else {
            if (midi.output_port_table[port.name + port.id]) {
                // Already present
                console.log('Warning: ignored repeated add of MIDI ' + port.type + ' port ' + port.name);
                return;
            }
            
            midi.output_port_table[port.name + port.id] = visible_port;
            midi.output_port_array.push(visible_port);
        }

        console.log('MIDI: Add ' + port.type + ' port ' + port.name);
    }

    // Reset the MIDI object
    midiReset();
    
    midi.$options.midiAccess = midiAccess;
    midi.$options.sysex = midiAccess.sysexEnabled;
   
    for (const port of midiAccess.inputs.values()) {
        // Adding this message triggers a statechange event that
        // causes the input port connection event, so we do not
        // explicitly call addPort() here for inputs.
        addPort(port);
    }

    for (const port of midiAccess.outputs.values()) {
        addPort(port);
    }

    midiAccess.onstatechange = function (event) {
        const port = event.port;

        // Need to delay, otherwise we might miss all of the disconnections that
        // happen this frame.
        setTimeout(updateMidiControllerIcons);
        
        if (port.state === 'connected') {
            // Connect
            addPort(port);
        } else {
            // Disconnect
            console.log('MIDI: Disconnected ' + port.type + ' port ' + port.name);

            if (port.type === 'input') {
                midi.input_port_table[port.name + port.id].state = port.state;
                delete midi.input_port_table[port.name + port.id];
                midi.input_port_array.splice(midi.input_port_array.indexOf(port), 1);
            } else if (port.type === 'output') {
                midi.output_port_table[port.name + port.id].state = port.state;
                delete midi.output_port_table[port.name + port.id];
                midi.output_port_array.splice(midi.output_port_array.indexOf(port), 1);
            }
        }
    };

    // After the event handlers run, sort input ports so that on
    // Novation Launchpad, the MIDI version of the input port comes
    // before the DAW one, since the MIDI one is probably what the
    // programmer wants.
    setTimeout(function () {
        function midiSort(a, b) {
            const am = (a.name.indexOf('MIDI') !== -1) && (a.name.indexOf('DAW') === -1) && (a.name.indexOf('Live') === -1) ? 1 : 0;
            const bm = (b.name.indexOf('MIDI') !== -1) && (b.name.indexOf('DAW') === -1) && (a.name.indexOf('Live') === -1) ? 1 : 0;
            return bm - am;
        }
        midi.input_port_array.sort(midiSort);
        midi.output_port_array.sort(midiSort);
    }, 150);

    if (emulatorMode !== 'stop') {
        // The game was already running when midi access came
        // through. This probably means that it was blocked on a user
        // dialog, and that the game started with the midi object in a
        // bad state. Restart the game.

        // In kiosk mode, this causes the virtual GPU to fail
        // to render, so as a temporary workaround we are not
        // running it in that mode.
        if (getQueryString('kiosk') !== '1') {
            onRestartButton();
        }
    }
}


function onMIDIInitFailure() {
    console.log('This web browser does not support MIDI. Try Chrome, Edge, Firefox, Opera, or Brave.');
}


function midiAfterFrame() {
    // Wipe the queue
    midi.message_queue.length = 0;
}


function midiInputChannelBeforeFrame(channel) {
    if (channel.$note_active) {
        const note = channel.note;
        for (let n = 0; n < 128; ++n) {
            note[n].on += note[n].on ? 1 : 0;
            note[n].pressed = note[n].released = false;
        }
    }
    
    if (channel.$controller_active) {
        const controller = channel.controller;
        for (let c = 0; c < 128; ++c) {
            controller[c].delta = 0;
        }
    }
}


function midiProcessInputMessage(channel, message) {
    switch (message.type) {
    case 'NOTE_ON':
        {
            channel.$note_active = true;
            
            const note = channel.note[message.note];
            if (message.velocity === 0) {
                // Treat as a note off
                note.released = true;
                note.on = 0;
            } else {
                note.pressed = true;
                note.velocity = message.velocity;
                note.pressure = 0;
                note.on = 1;
            }
        }
        break;
        
    case 'NOTE_OFF':
        {
            const note = channel.note[message.note];
            channel.$note_active = true;
            note.released = true;
            note.on = 0;
        }
        break;
        
    case 'POLYPHONIC_AFTERTOUCH':
        channel.$note_active = true;
        channel.note[message.note].pressure = message.pressure;
        break;
        
    case 'CONTROL_CHANGE':
        {
            channel.$controller_active = true;
            const controller = channel.controller[message.controller];
            controller.delta += message.data - controller.value;
            controller.value = message.data;
        }
        break;       
        
    } // switch on type
}


/** Called per frame to update the input ports from the
    message_queue. Must also zero the message_queue after providing to
    the game. */
function midiBeforeFrame() {
    // Increment every note that was held down and reset deltas for
    // controllers for channels that have received active input
    // previously.
    for (const name in midi.input_port_table) {
        const port = midi.input_port_table[name];

        // The port acts as an aggregate channel
        midiInputChannelBeforeFrame(port);

        for (let c = 0; c < 16; ++c) {
            midiInputChannelBeforeFrame(port.channel[c]);
        }
    }

    for (const message of midi.message_queue) {
        const port = message.port;
        midiProcessInputMessage(port, message);

        if (message.channel !== undefined) {
            midiProcessInputMessage(port.channel[message.channel], message);
        }
    } // for each message
}


// See also updateControllerIcons
function updateMidiControllerIcons() {
    {
        const element = document.getElementById('midiIcon0');
        const N = midi.input_port_array.length;
        if (N > 0) {
            element.className = 'midiPresent';
            element.title = midi.input_port_array[0].name +
                (N > 1 ? '\nand ' + (N - 1) + ' other MIDI input devices' : '') +
                '\n\nClick for details';
        } else {
            element.className = 'midiAbsent';
            element.title = 'Connect a USB MIDI input device';
        }
    }
    {
        const element = document.getElementById('midiIcon1');
        const N = midi.output_port_array.length;
        if (N > 0) {
            element.className = 'midiPresent';
            element.title = midi.output_port_array[0].name +
                (N > 1 ? '\nand ' + (N - 1) + ' other MIDI output devices' : '') +
                '\n\nClick for details';
        } else {
            element.className = 'midiAbsent';
            element.title = 'Connect a USB MIDI output device';
        }
    }
}
