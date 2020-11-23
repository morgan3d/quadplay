/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License*/
"use strict";

/* Initialized at the bottom of this file */
let myHostNetID;
let myOnlineName;
const NET_ID_PREFIX = 'qp000';
const MAX_ONLINE_NAME_LENGTH = 7;

// Run the input at twice the frame rate to try and
// reduce input latency for the server. (Minimum timer
// period in JavaScript is 4ms)
const ONLINE_INPUT_PERIOD = Math.floor(1000 / 120);

const PEER_CONFIG = false ? {} : {
    debug: 0,
    host: "peer.pixelverse.org",
    port: 9001,
    path: '/remoteplay',
    key: 'remoteplay'
};

/*
 There is no consistent way to detect a closed WebRTC connection
 across browsers, so we have to send keepalive messages. PeerJS has
 its own parameters for ping rates, but does not appear to use them at
 present on investigating the code.
*/
const KEEP_ALIVE_INTERVAL_MS = 0.25 * 1000;
const KEEP_ALIVE_MESSAGE = 'KEEP_ALIVE';

/* 
 How many intervals can be missed before we drop connection.  This
 has to be long enough that during game load the connection isn't
 dropped. 
*/
const KEEP_ALIVE_MISSABLE_INTERVALS = Math.ceil(6 * 1000 / KEEP_ALIVE_INTERVAL_MS);


/* 
 Milliseconds since epoch in UTC. Used for detecting when the last
 keepAlive was received. 
*/
function keepAliveTime() {
    return new Date().getTime();
}

/* 
 Perpetually send keep alive messages to this dataConnection, and
 listen for them coming back. getVideo() is a callback because the
 video may not be available right when the data connection is.

 This should automatically shut down when we destroy our peer to
 stop hosting.
*/
function keepAlive(dataConnection, setWarning, dropCallback) {
    dataConnection.messageHandlerArray = dataConnection.messageHandlerArray || [];
    dataConnection.on('data', function (message) {
        for (let i = 0; i < dataConnection.messageHandlerArray.length; ++i) {
            if (dataConnection.messageHandlerArray[i](message)) { return; }
        }
    });

    // Undefined until the first message comes in
    let lastTime = undefined;

    // Save the ID, which may become invalid if the connection fails
    const elementID = '_' + dataConnection.peer;

    function ping() {
        const currentTime = keepAliveTime();
        if (lastTime && (currentTime - lastTime > KEEP_ALIVE_MISSABLE_INTERVALS * KEEP_ALIVE_INTERVAL_MS)) {
            // The other side seems to have dropped connection
            console.log('lost connection. ', (currentTime - lastTime) / 1000, 'seconds without a keepAlive message.');
            // Ending the iterative callback chain should allow garbage collection to occur
            // and destroy all resources
            dropCallback && dropCallback(dataConnection);
        } else {
            // console.log('sent KEEP_ALIVE message');
            dataConnection.send(KEEP_ALIVE_MESSAGE);

            // Show or hide the connection warning as appropriate. Note that the element might not exist
            // right at the beginning of the connection.
            const connectionIsBad = lastTime && (currentTime - lastTime >= 2 * KEEP_ALIVE_INTERVAL_MS);
            setWarning && setWarning(dataConnection, connectionIsBad);

            // Schedule the next ping
            setTimeout(ping, KEEP_ALIVE_INTERVAL_MS);
        }
    }

    dataConnection.messageHandlerArray.push(function (data) {
        if (data === KEEP_ALIVE_MESSAGE) { lastTime = keepAliveTime(); return true; }
        // console.log('received data', data);
    });

    // Start the endless keepAlive process
    ping(dataConnection);
}



// 6x32, maximum 4-letter words chosen to fit the pattern (adjective,
// noun)x3 and with the constraint that each word is unique and 
// minimizes phoenetic similarity, for clear verbal communication of netIDs
const NET_ID_WORD_TABLE = Object.freeze([
    Object.freeze(['bent', 'blue', 'bold', 'cool', 'dim', 'dry', 'east', 'epic', 'far', 'fast', 'fell', 'fire', 'free', 'gray', 'hale', 'holy', 'hot', 'iron', 'kind', 'lake', 'last', 'left', 'next', 'old', 'rock', 'sea', 'tall', 'tiny', 'used', 'wild', 'worn', 'zen']),
    Object.freeze(['band', 'bar', 'bell', 'bird', 'boar', 'boat', 'card', 'chin', 'crow', 'deer', 'desk', 'frog', 'gate', 'goat', 'hair', 'hand', 'hawk', 'home', 'hope', 'jack', 'jump', 'kiss', 'land', 'move', 'rope', 'ship', 'sun', 'taco', 'veil', 'wand', 'well', 'year']),
    Object.freeze(['able', 'calm', 'cold', 'dark', 'deep', 'evil', 'fair', 'felt', 'full', 'gilt', 'good', 'high', 'late', 'low', 'mini', 'near', 'nice', 'pale', 'past', 'pink', 'rare', 'raw', 'red', 'rich', 'rose', 'safe', 'slow', 'tidy', 'thin', 'warm', 'weak', 'wet']),
    Object.freeze(['axe', 'bath', 'bear', 'bow', 'cane', 'cat', 'coin', 'day', 'dove', 'fish', 'flag', 'gem', 'hero', 'hill', 'inn', 'key', 'king', 'lion', 'moon', 'nail', 'oar', 'oven', 'plum', 'rail', 'sand', 'snow', 'song', 'star', 'tree', 'vine', 'wing', 'wolf']),
    Object.freeze(['apt', 'big', 'dull', 'dun', 'easy', 'fake', 'fine', 'fit', 'gold', 'half', 'hard', 'ice', 'long', 'lost', 'loud', 'my', 'new', 'odd', 'one', 'our', 'peak', 'poor', 'posh', 'real', 'soft', 'sour', 'tame', 'time', 'true', 'twin', 'west', 'your']),
    Object.freeze(['belt', 'boot', 'corn', 'crab', 'deer', 'door', 'eye', 'food', 'gift', 'gull', 'head', 'hen', 'isle', 'lady', 'life', 'line', 'lock', 'math', 'pear', 'pool', 'rain', 'road', 'root', 'ruin', 'sail', 'shoe', 'soul', 'town', 'turn', 'wind', 'wish', 'zero'])]);

/* 
   Generates an integer between 0 and 32^6-1 (about one billion) that
   is unlikely to be generated by a different computer running quadplay,
   and then converts to the netID string format.
*/
function generateNetID() {
    // Math.random() varies across platforms in its implementation,
    // and is initialized differently per instance (how reliably it is
    // initialized is unknown).
    //
    // performance.now returns a time from an arbitrary baseline in
    // milliseconds, with a fractional part. The accuracy of the
    // fractional part varies across platforms, but the time within a
    // second should generally be uniformly distributed.
    const MAX = 0x40000000;

    // Because the inputs have finite precision, multiplication and
    // modulo do not make the outputs uniformly distributed; there's a
    // little clumping but it should be fine for our purpose here.
    const A = Math.random();
    const B = (performance.now() % 1000) / 1000;
    return NET_ID_PREFIX + ('' + Math.min(MAX - 1, Math.floor(MAX * ((A + B) % 1)))).padStart(10, '0');
}


/* Returns an array of six words */
function netIDToWords(id) {

    id = parseInt(id.substring(NET_ID_PREFIX.length));
    let list = [];
    for (let word = 0; word < 6; ++word) {
        list.push(capitalize(NET_ID_WORD_TABLE[word][id & 31]));
        id >>= 5;
    }
    
    return list;
}


function netIDToString(netID, name) {
    let text = netIDToSentence(netID);
    if (name && (name.toLowerCase() !== 'unknown') && (name !== '')) {
        text = name.toUpperCase().substring(0, MAX_ONLINE_NAME_LENGTH) + ' (' + text + ')';        
    }
    return text;
}


function netIDToSentence(netID) {
    const list = netIDToWords(netID);
    return list[0] + " " + list[1] + ", " + list[2] + " " + list[3] + ", " + list[4] + " " + list[5];
}


/** Returns a value comparable to generateNetID() */
function wordsToNetID(list) {
    let id = 0;
    for (let word = 5; word >= 0; --word) {
        id <<= 5;
        id |= NET_ID_WORD_TABLE[word].indexOf(list[word].toLowerCase());
    }
    
    return NET_ID_PREFIX + ('' + id).padStart(10, '0');
}


/* Call to replace myHostNetID and commit the new one to localStorage.
   Returns the new ID  */
function changeMyHostNetID() {
    myHostNetID = generateNetID();
    localStorage.setItem('myHostNetID', myHostNetID);
    return myHostNetID;
}


/* For use by the QRuntime */
function getMyHostNetID() {
    return myHostNetID;
}


function setMyOnlineName(n) {
    n = n.trim();
    myOnlineName = '';
    // Only permit quadplay characters
    for (let i = 0; i < n.length; ++i) {
        if (fontMap[n[i]] !== undefined) {
            myOnlineName += n[i];
        }
    }
    if (myOnlineName.length === 0) {
        myOnlineName = 'Unknown';
    }
    myOnlineName = myOnlineName.substring(0, MAX_ONLINE_NAME_LENGTH);
    localStorage.setItem('myOnlineName', myOnlineName);
}


function getMyOnlineName() {
    return myOnlineName;
}


function getIsHosting() {
    return isHosting;
}


function getIsOffline() {
    return isOffline;
}


function peerErrorHandler(err) {
    let msg = err + '';
    if (! msg.endsWith('.')) { msg += '.'; }
    if (msg.indexOf('concurrent user limit') !== -1) {
        msg += ' The peer server is too popular right now. Try again in a little while.';
    }
    console.log(msg);
    //document.getElementById('urlbox').innerHTML = `Sorry. <span style="color:red">${msg}</span>`;
}


function startHosting() {
    console.log('startHosting()');
    localStorage.setItem("last_hosted", "true");
    isHosting = true;
    
    // Create the video stream. Setting the frame rate here increases
    // latency. Instead, specify when the buffer has changed
    // explicitly in the rendering routines. Setting the rate
    // explicitly to 0 seems to improve Safari guests. On Firefox,
    // requestFrame() doesn't work on the host so we have to allow
    // auto streaming.
    let screenStream = document.getElementById('screen').captureStream(isFirefox ? undefined : 0);
    hostVideoTrack = screenStream.getVideoTracks()[0];

    hostAudioDestination = audioContext.createMediaStreamDestination();
    audioContext.gainNode.connect(hostAudioDestination);
    hostAudioTrack = hostAudioDestination.stream.getAudioTracks()[0];
    screenStream = new MediaStream([hostVideoTrack, hostAudioTrack]);

    if (! deployed) {
        // Local monitor when debugging
        const videoElement = document.getElementById('guestVideo');
        videoElement.style.zIndex = 100;
        videoElement.style.visibility = 'visible';
        videoElement.srcObject = screenStream;
    }

    // The peer must be created RIGHT before open is registered,
    // otherwise we could miss it.
    myPeer = new Peer(myHostNetID, PEER_CONFIG);

    myPeer.on('error', peerErrorHandler);
    
    myPeer.on('open', function(id) {
        console.log('host peer opened with id ' + id);

        // The guest calls us on the data channel
        myPeer.on('connection', function (dataConnection) {
            console.log('data connection to guest established');

            console.log('calling the guest back with the stream');
            const mediaConnection = myPeer.call(dataConnection.peer, screenStream);

            // Find an available player index
            let player_index = 1;
            let conflict = false;
            do {
                conflict = false;
                for (let i = 0; i < connectedGuestArray.length; ++i) {
                    if (connectedGuestArray[i].player_index === player_index) {
                        conflict = true;
                        ++player_index;
                        break;
                    }
                }
            } while (conflict);

            // Show a message here on the host
            showPopupMessage(dataConnection.metadata.name.toUpperCase() + ' joined as P' + (player_index + 1));

            // Preven the local input from overriding remote input
            QRuntime.gamepad_array[player_index].$is_guest = true;
            
            // Register keepAlive
            keepAlive(dataConnection, undefined, function (dataConnection) {
                // Remove from the guest array
                for (let i = 0; i < connectedGuestArray.length; ++i) {
                    window.QRuntime.gamepad_array[player_index].$is_guest = false;
                    if (connectedGuestArray.dataConnection === dataConnection) {
                        connectedGuestArray.splice(i, 1);
                        break;
                    }
                }
                showPopupMessage(dataConnection.metadata.name.toUpperCase() + ' left');
            });

            dataConnection.messageHandlerArray.push(function (message) {
                if (message.type !== 'INPUT') { return false; }

                // Overwrite the local controller for this connection
                // (ignore if the game is still loading, so there is
                // no gamepad_array)
                
                // The runtime can be reloaded when a game launches,
                // so grab the current runtime, not the one captured
                // by this closure.
                const array = window.QRuntime.gamepad_array;
                if (array) {
                    // updateInput() will update properties from this absolute state
                    // once per frame
                    array[player_index].$guest_latest_state = message.gamepad_array[0];
                    array[player_index].$is_guest = true;
                } else {
                    console.log('ignored INPUT network message because runtime is reloading');
                }
                
                return true;
            });

            function sendConnectMessage() {
                dataConnection.send({type: 'CONNECT', name: myOnlineName, player_index: player_index});
                console.log('sent connect message');
            }
            
            // Sometimes the guest never receives this first message
            // (even if reliable connections are turned on), so we
            // send a few times with delays. Once the first message
            // is processed, the others will be ignored.
            for (let i = 0; i < 7; ++i) {
                setTimeout(sendConnectMessage, i * 200);
            }
        });
        
    }); // myPeer.on('open')
}

    
function stopHosting() {
    if (hostVideoTrack) {
        hostVideoTrack.stop();
        hostVideoTrack = null;
    }

    if (hostAudioTrack) {
        hostAudioTrack.stop();
        hostAudioTrack = null;
    }

    if (hostAudioDestination) {
        audioContext.gainNode.disconnect(hostAudioDestination);
        hostAudioDestination = null;
    }

    if (myPeer && isHosting) {
        connectedGuestArray.length = 0;
        console.log('stopHosting()');
        myPeer.destroy();
        myPeer = null;
    }

    isHosting = false
}


function startGuesting(hostNetID) {
    isGuesting = true;
    localStorage.setItem("last_hosted", "false");
    console.log('startGuesting("' + hostNetID + '")');

    // Pause quadplay's regular loop to allow streaming to take over
    onPauseButton();
    
    const videoElement = document.getElementById('guestVideo');

    if (isSafari) {
        // Safari requires this, and it must be called from an event handler
        videoElement.play();
    } else {
        // On Safari, video will not update unless the video element is in the
        // DOM and visible, so we hide it behind the canvas instead of hiding
        // it completely (which is friendlier to the browser compositor).
        videoElement.style.visibility = 'hidden';
    }        

    if (! deployed) {
        // Show the video element for debugging
        videoElement.style.zIndex = 100;
        videoElement.style.visibility = 'visible';
    }
    
    myPeer = new Peer(myHostNetID, PEER_CONFIG);

    // Will be set on load
    let videoWidth = 384, videoHeight = 224;
    let dataConnection;

    function drawVideo() {
        // Shut down the video rendering when we stop being a guest
        if (! isGuesting) {
            videoElement.srcObject = null;
            console.log('guest terminating drawVideo() chain');
            return;
        }
        
        // Instead of showing the video directly, render it to the
        // canvas so that it is cleaned up by pixelization.
        ctx.drawImage(videoElement, 0, 0, videoWidth, videoHeight);
        
        // Run right before vsync to eliminate latency between the
        // video update and the canvas update. This will overdraw if the monitor
        // runs at higher than FRAMERATE_HZ, but the client isn't
        // doing much work anyway. 
        requestAnimationFrame(drawVideo);
    }

    // Absolute properties to send. Everything else is reconstructed
    // in the host's updateInput() call.
    const GAMEPAD_PROPERTY_ARRAY = ['$x', '$y', 'a', 'b', 'c', 'd', 'e', 'f', '$p', 'q', '$analog', 'type', 'prompt', 'id'];
    const inputObject = {};

    // Use the interval timer here to get the most regular timing possible
    let inputInterval = null;
    function sampleInput() {
        if (! isGuesting) {
            console.log('guest terminating sampleInput() interval');
            clearInterval(inputInterval);
            inputInterval = null;
            return;
        }

        // Sample input so that controllers are live
        // to send to the host
        updateInput();

        // Send absolute controls to the host
        if (dataConnection) {
            // Clone, stripping accessors. Note that
            // $name, index, and player_color fields
            // must be set on the host, and accessors
            // are not useful
            const gamepad = window.QRuntime.gamepad_array[0];
            for (let i = 0; i < GAMEPAD_PROPERTY_ARRAY.length; ++i) {
                const P = GAMEPAD_PROPERTY_ARRAY[i];
                inputObject[P] = gamepad[P];
            }

            dataConnection.send({type: 'INPUT', gamepad_array: [inputObject]});
        }
    }
    
    myPeer.on('error', peerErrorHandler);
    
    myPeer.on('open', function (id) {
        let alreadyAddedThisCall = false;

        // PeerJS cannot initiate a call without a media stream, so the
        // client can't initiate the call. Instead, we have the client
        // initiate a data connection and then the host calls *back*
        // with the media stream.
        
        // When the host calls us back
        myPeer.on('call', function (mediaConnection) {
            console.log('host called back');

            // Answer the call but provide no media stream
            mediaConnection.answer(null);
            
            mediaConnection.on(
                'stream',
                function (hostStream) {
                    if (! alreadyAddedThisCall) {
                        alreadyAddedThisCall = true;
                        console.log('host answered');
                        
                        hostStream.addEventListener('addtrack', function (event) {
                            if (event.track.kind !== 'video') { return; }
                            // The track's width and height are not available
                            // here, so wait
                            setTimeout(function () {
                                const settings = hostStream.getVideoTracks()[0].getSettings();
                                console.log(`incoming video is ${settings.width} x ${settings.height}`);
                                if (settings.width) {
                                    videoWidth = settings.width;
                                    videoHeight = settings.height;
                                }
                            }, 1000);
                        });
                        
                        videoElement.srcObject = hostStream;
                        
                        // Start the callback chain
                        drawVideo();
                        inputInterval = setInterval(sampleInput, ONLINE_INPUT_PERIOD);
                    } else {
                        console.log('rejected duplicate call');
                    }
                },
                
                function (err) {
                    console.log('host stream failed with', err);
                }
            ); //mediaConnection.on('stream')
        }); // myPeer.on('call')

        
        console.log('connect data to host');
        // This will trigger the host to call back with a mediaConnection as well
        dataConnection = myPeer.connect(hostNetID, {reliable: false, serialization: 'json', metadata: {name: myOnlineName}});
        function connectHandler(message) {
            if (message.type !== 'CONNECT') { return false;}
            
            console.log('received CONNECT message from host');
            
            // Store the host in the recent list on successful connect
            const recent_host_array = QRuntime.parse(localStorage.getItem('recent_host_array') || '[]');
            // Remove any previous instance of this ID
            for (let i = 0; i < recent_host_array.length; ++i) {
                if (recent_host_array[i].code === hostNetID) {
                    recent_host_array.splice(i, 1);
                    break
                }
            }
            recent_host_array.unshift({code: hostNetID, name: message.name});
            recent_host_array.length = Math.min(recent_host_array.length, 3);
            localStorage.setItem('recent_host_array', QRuntime.unparse(recent_host_array, true));
            
            showPopupMessage('You are visiting ' + netIDToString(dataConnection.peer, message.name) + '<br>as P' + (message.player_index + 1) + ' ' + myOnlineName.toUpperCase());
            
            // Remove this message handler since it will never matter again. The
            // handling loop terminates immediately after we return, so it is safe
            // to mutate here.
            QRuntime.remove_values(dataConnection.messageHandlerArray, connectHandler)
            
            // Consume message
            return true;
        }
            
        // Handler for connection message must be registed before the on('data') handler
        dataConnection.messageHandlerArray = [connectHandler];
        dataConnection.on('open', function () {
            console.log('data connection to host established');
            
            keepAlive(dataConnection, undefined, function () {
                showPopupMessage('You lost connection to the host.');
                setTimeout(stopGuesting);
            });
        });
        

    }); // myPeer.on('open')
}


/* noResume = true is used by quadplay's IDE when the actual stop
   button is pressed */
function stopGuesting(noResume) {
    if (isGuesting && myPeer) {
        console.log('stopGuesting()');
        myPeer.destroy();
        myPeer = null;
    }
    isGuesting = false;
    
    // Shut down the streaming and resume quadplay. Fortunately...
    // quadplay's state was paused in the place where it should
    // resume.

    if (! noResume) {
        onPlayButton();
    }
}


/* Is this machine currently hosting online play? */
let isHosting = false;
let isGuesting = false;

/* Used on the host side to requestFrame() on the host side */
let hostVideoTrack = null;
let hostAudioTrack = null;
let hostAudioDestination = null;

let myPeer = null;

const connectedGuestArray = [];
myHostNetID = localStorage.getItem('myHostNetID') || changeMyHostNetID();
myOnlineName = localStorage.getItem('myOnlineName') || getQueryString('name') || 'Unknown';
