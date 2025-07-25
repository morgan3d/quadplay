/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */

"use strict";

const conduitNetwork = {
    // Status of the connection to the signalling server, which is indicative of the systems's
    // readiness to create peer connections.
    //
    // 'uninitialized' -> 'pending' -> 'online' <--> 'offline'
    //                        |                         ^
    //                        '-------------------------'
    //
    //
    // If in the uninitialized state, with a non-null node_netid, this indicates that
    // the signalling server closed the connection but the system has been previously
    // initialized. This distinguishes from the case of never having been initialized.
    status: 'uninitialized',

    // The PeerJS peer for this node
    peer: null,

    // Unique ID string for this game web server
    game_uuid: null,

    // Store the node netid for immediate access prior to the peerjs peer
    // connecting to the signalling server and being able to report its
    // peerjsid back for conversion to a netid.
    node_netid: null,

    // Table of outstanding discovery server connection attempts
    // Maps peerjs_id -> {successCallback, disconnectCallback}. Used
    // to route errors on peer to the appropriate attempt.
    pending_discovery_connections: {},

    // Queue of functions to execute when the peer comes online
    // Usually contains only one function (from make_conduit calls during startup)
    work_queue: [],

    // Set of WeakRef to all open conduits for cleanup on disconnection from the signalling
    // server or at program termination. Also used to match incoming PeerJS connections
    // to the appropriate conduit based on conduit_netid in connection metadata.
    // Note that JavaScript WeakSet does not allow iteration, so cannot be used here.
    open_conduits: new Set(),

    // Queue of incoming PeerJS connections for single conduits that reference this node's
    // netid. These are held until conduit_listen() is called to create the appropriate conduit.
    listen_queue: [],

    // Configurable logging function
    log: console.log,

    // If not null, this is a setInterval() timer ID for the peer-to-signalling-server reconnect attempt.
    // It is not used for discovery server reconnects, which are handled with transient setTimer()
    // calls.
    reconnect_timer: null,

    // For handling discovery server disconnection on a group conduit. The value
    // used at a node is a random number between a few milliseconds and this value.
    DISCOVERY_SERVER_TAKEOVER_MAX_DELAY_SECONDS: 1.0,

    // For handling discovery server initial connection on a group conduit,
    // which may fail due to there being no server, or for this node being offline
    DISCOVERY_INITIAL_RECONNECT_DELAY_SECONDS: 0.3,

    // Timeout for discovery server connection attempts (PeerJS doesn't always timeout reliably)
    DISCOVERY_CONNECTION_TIMEOUT_SECONDS: 4,
    
    // For handling signalling server disconnection of the peer.js peer. This is how frequently
    // network reconnects are attempted when kicked offline
    NETWORK_RECONNECT_DELAY_SECONDS: 0.25
};


// Scope line for private namespace to avoid polluting the 
// rest of the quadplay system namespace with network helpers.
{

/* Initialize the API if it is not already. On return after the first call the communication
   to the signalling server to establish communication will still be pending.

   `node_netid` - Use this id if creating, if defined. Used only by set_node_netid(). */
conduitNetwork.init = function init(node_netid) {
    if (conduitNetwork.peer) {
        // Already initialized
        return;
    }

    // In the case of a forced disconnection from a close, allow coming back with the original node_netid
    // if the program wants to rebuild the conduits. 
    if (! node_netid && ! conduitNetwork.node_netid) {
        node_netid = 'node_netid ' + crypto.randomUUID();
    }

    if (! node_netid.startsWith('node_netid ')) {
        throw 'Illegal node_netid';
    }
   
    // Store the node netid for immediate access
    conduitNetwork.node_netid = node_netid;
    conduitNetwork.game_uuid = ' '  + ((gameURL.startsWith('quad://')) ? location.href : '') + gameURL;
    conduitNetwork.peer = new Peer(netid_to_peerid(node_netid));
    
    // Set status to pending while awaiting connection to signaling server
    conduitNetwork.status = 'pending';
    
    // Set up peer open handler - connection to signaling server succeeded
    conduitNetwork.peer.on('open', function (id) {
        const wasOffline = (conduitNetwork.status === 'offline');
        
        if (wasOffline) {
            conduitNetwork.log('Network back online');
            handle_network_reconnection();
        } else {
            conduitNetwork.log(`Connected to signaling server using my netid: "<code>${peerid_to_netid(id)}</code>"`);
            conduitNetwork.status = 'online';
        }
        
        // Execute all queued functions now that we're online
        // Usually contains only one function (from make_conduit calls during startup)
        while (conduitNetwork.work_queue.length > 0) {
            const queuedFunction = conduitNetwork.work_queue.shift();
            // If a queued function throws an exception, that's a program logic error - don't catch it
            queuedFunction();
        }
    });
    
    // Set up peer disconnected handler. When this event occurs, the peer is disconnected from signaling 
    // server but can reconnect. This event is fired repeatedly while disconnected, not just once on disconnect.
    conduitNetwork.peer.on('disconnected', function(id) {
        if (conduitNetwork.status === 'offline') {
            console.log('Ignored peer.js repeated disconnected event');
            return;
        }

        conduitNetwork.log(`Disconnected from signaling server (netid: "<code>${peerid_to_netid(id)}</code>")`);
        conduitNetwork.log('conduitNetwork.status =', conduitNetwork.status);
        conduitNetwork.status = 'offline';
        handle_network_disconnection();
    });
    
    // Set up peer close handler - connection to signaling server lost permanently
    conduitNetwork.peer.on('close', function() {
        if (conduitNetwork.status === 'uninitialized') {
            // We received this event after we intentionally closed the connection during reset_conduits,
            // so there is nothing to do.
            conduitNetwork.log('Ignored peer.js signalling server close event that was triggered by reset_conduits()');
        } else if (conduitNetwork.status === 'pending') {

            conduitNetwork.log('Ignored peer.js signalling server close event while connecting');
        } else if (conduitNetwork.status === 'offline') {

            conduitNetwork.log('Ignored peer.js signalling server close event while already offline');

        } else {
            console.assert(conduitNetwork.status === 'online');
            conduitNetwork.log('conduitNetwork.status =', conduitNetwork.status);

            // We *can* try to connected to the signalling server and force the same peer.js ID, 
            // but will have to rebuild all peer.js connections rather than reconnect() them. That 
            // is not implemented yet, so force everything to offline and closed.
            conduitNetwork.log('Lost connection to signaling server (closed)');
            conduitNetwork.reset_conduits(false);
        }
    });
    
    // Set up centralized error handler for discovery server connection failures. This handler
    // is called with 'peer-unavailable' when trying to connect to a discovery server that does not
    // exist, and called with 'network' repeatedly when offline due to reconnect() calls
    conduitNetwork.peer.on('error', function(err) {        
        if (err.type === 'peer-unavailable') {
            // Check if this error is for a discovery server we're trying to connect to
            for (const peerjs_id in conduitNetwork.pending_discovery_connections) {
                if (err.message.indexOf(peerjs_id) !== -1) {
                    const conduit = conduitNetwork.pending_discovery_connections[peerjs_id];
                    delete conduitNetwork.pending_discovery_connections[peerjs_id];
                    
                    // Trigger the error handler on the discovery connection if it exists
                    if (conduit && conduit.$discovery_error_callback) {
                        // Call the error handler directly instead of using undocumented emit()
                        conduit.$discovery_error_callback(err);
                    }
                    return;
                }
            }
            conduitNetwork.log('peer-unavailable error did not match any pending discovery connections');

        } else if (err.type === 'network' || err.type === 'browser-incompatible') {
            // As of July 2025, when offline:
            //   FireFox -> browser-incompatible error
            //   Chromium -> network error

            if (conduitNetwork.status === 'pending') {
                // Trying to start while offline
                conduitNetwork.log('Initial connect to the signaling server failed. Starting with offline status.');

                // We are not going to succeed in creating the peer in the first place.
                conduitNetwork.status = 'offline';

                // Stop trying to make the peer, and start a timer that will look for success
                // TODO: Does peer.js do this by itself?

            } else if (conduitNetwork.status !== 'offline') {
                // Connection to signaling server lost.
                conduitNetwork.log('Lost connection to signaling server. Changing to offline status.');
                handle_network_disconnection();
            } else {
                console.log('Ignored peer.js repeated network error because already offline');
                return;
            }

        } else {
            conduitNetwork.log('Unhandled peer error:', err);
            conduitNetwork.reset_conduits(true);
        }
    });
    
    // Set up handler for incoming peer connections
    conduitNetwork.peer.on('connection', register_incoming_connection);

}    


////////////////////////////////////////////////////////////////////////////////////
// quadplay API

/*
  Create a connection to one or more nodes on the network. netid is a string.

  If netid begins with the string "group_netid", then the conduit communicates
  many-to-many with all nodes in that group that are running the same game
  loaded from the same server, i.e., from the same URL. You do not need to
  put the name of your game in the ID. (The restriction to the same game is
  to make it harder for someone to fork your game and then corrupt its network
  communications.)

  If netid begins with the string "node_netid", then the conduit communicates
  one-to-one with a single node that was calling conduit_listen(). You must
  have obtained that netid through some side band, or chosen to make it fixed
  if you are connecting to a server.
*/
conduitNetwork.make_conduit = function make_conduit(netid = "group_netid 0000") {
    conduitNetwork.init();

    const conduit = {
        // kind: 'group' or 'node'
        $kind: netid.startsWith('group_netid') ? 'group' : 'node',

        // unified event queue (contains {type, node_netid, data} objects)
        // type: 'join', 'message', or 'leave'
        // data: only present for 'message' events, contains {message, from_netid}
        $event_queue: [],
        
        // The "offline" state in the public API means that the node
        // is disconnected from the signalling server, but may reconnect--
        // this is implemented by the conduit $status remaining "online" but
        // the accessor masking the value to "offline", avoiding the need
        // to change all conduit.$status values when reconnect is successful.
        $status: 'pending',

        ///////////////////////////////////////////////////////
        // For a group many:many connection

        // group: peerjs connection from the client to the discovery server, which is usually not on this node
        $discovery_dataconnection: null,

        // Discovery server state (peer object and client_table). This is only used if this node
        // is also the discovery server for the group, which occurs if it is the first member of
        // the group or if the previous server went offline and this node took over. This is null
        // for most nodes. The state is stored here only to prevent garbage collection and to
        // support debugging. It is never explicitly referenced in the implementation.
        $discovery_server: null,

        // Maps netids to Peerjs dataconnections for group connections. This is the list of all other
        // peer nodes maintained by the client.
        $peer_dataconnection_table: {},

        // Defined by connect_to_discovery_server to abstract the many cases where discovery fails
        $discovery_error_callback: null,
    };

    Object.defineProperty(conduit, 'netid', {value: netid, writable: false});

    // If the network itself is offline, mask the conduit's status and just report
    // it as offline as well. This simplifies state management when restoring a connection.
    Object.defineProperty(conduit, 'status', {get() {
        if (conduitNetwork.status === 'offline') {
            return 'offline';
        } else {
            return conduit.$status;
        }
    }});
    
    // Seal the object after defining all properties
    Object.seal(conduit);

    // Add conduit as WeakRef to the set for disconnection handling
    conduitNetwork.open_conduits.add(new WeakRef(conduit));

    let connectFunction;

    // If this is a group connection, connect to the discovery server for this netid. It will have 
    // the peerjs ID that is the group's ID.
    if (netid.startsWith('group_netid')) {        

        connectFunction = function do_discovery_connect() {
            connect_to_discovery_server(conduit, netid);
        }

    } else if (netid.startsWith("node_netid")) {

        connectFunction = function do_single_connect() {
            connect_to_peer(conduit, netid);

            // Set up keepalive if needed
            // TODO: Test whether PeerJS close handlers fire reliably when connections are abruptly closed.
            // If not, implement periodic ping/pong keepalive mechanism for single conduits.
        }

    } else {
        throw Error(`Illegal netid: "${netid}"`);
    }

    if (conduitNetwork.status === 'online') {
        connectFunction();
  } else if (conduitNetwork.status === 'pending' || conduitNetwork.status === 'offline') {
        conduitNetwork.work_queue.push(connectFunction);
    }

    return conduit;
}


/* Get the netid for this node, which is a globally unique string per
  session unless set_node_netid() has been called. */
conduitNetwork.get_node_netid = function get_node_netid() {
    conduitNetwork.init();
    return conduitNetwork.node_netid;
}


/* Get the network status: 'pending', 'online', or 'offline'.
   This indicates the connection status to the PeerJS signaling server. */
conduitNetwork.get_conduit_online_status = function get_conduit_online_status() {
    conduitNetwork.init();
    return conduitNetwork.status;
}


/* Create a single conduit that will accept incoming connections to this node's netid.
   Processes any queued incoming connections that were received before this call. */
conduitNetwork.conduit_listen = function conduit_listen(netid = conduitNetwork.node_netid) {
    conduitNetwork.init();
    
    if (netid !== conduitNetwork.node_netid) {
        conduitNetwork.log('Warning: conduit_listen called with netid', netid, 'but node_netid is', conduitNetwork.node_netid);
    }
    
    // Create a single conduit for this netid
    const conduit = {
        $kind: 'node',
        $receive_queue: [],
        $leave_queue: [],
        $status: 'online',
        $discovery_dataconnection: null,
        $discovery_server: null,
        $peer_dataconnection_table: {},
    };
    
    Object.defineProperty(conduit, 'netid', {value: netid, writable: false});

    Object.defineProperty(conduit, 'status', {get() {
        if (conduitNetwork.$status === 'offline') {
            return 'offline';
        } else {
            return conduit.$status;
        }
    }});
    
    Object.seal(conduit);
    
    conduitNetwork.open_conduits.add(new WeakRef(conduit));
    
    // Process any queued incoming connections for this netid
    const processedConnections = [];
    for (let i = conduitNetwork.listen_queue.length - 1; i >= 0; i--) {
        const pending = conduitNetwork.listen_queue[i];
        if (pending.conduit_netid === netid) {
            // Set up the connection for this conduit
            const connection = pending.peerjs_dataconnection;

            conduit.$peer_dataconnection_table[pending.from_netid] = connection;
            connection.on('data', makeMessageHandler(conduit, pending.from_netid));
            connection.on('close', makeCloseHandler(conduit, pending.from_netid));
            connection.on('error', makeErrorHandler(conduit, pending.from_netid));
            
            // Remove from pending queue
            conduitNetwork.listen_queue.splice(i, 1);
            processedConnections.push(pending.from_netid);
        }
    }
    
    return conduit;
}


/* Send this message, which can be any serializable message. 
   */
conduitNetwork.conduit_send = function conduit_send(conduit, message) {
    const packet = serialize(message, quadplaySerializeTransform);
    // Send to everyone (which for a single connection is one element)
    for (const [netid, dataconnection] of Object.entries(conduit.$peer_dataconnection_table)) {
        if (dataconnection.open) {
            dataconnection.send(packet);
        }
    }
}

/* Iterate through all incoming messages and events on the conduit. Events are processed in order
  to preserve the sequence of join, message, and leave events. For each event, calls the appropriate
  handler: message_handler(message, node_netid, conduit) for messages, join_handler(node_netid, conduit)
  for joins, and leave_handler(node_netid, conduit) for leaves.*/
conduitNetwork.conduit_iterate = function conduit_iterate(conduit, message_handler, join_handler, leave_handler) {    
    // Process all events in order to preserve sequence
    while (conduit.$event_queue.length > 0) {
        const event = conduit.$event_queue.shift();
        
        switch (event.type) {
        case 'join':
            join_handler?.(event.node_netid, conduit);
            break;
        case 'message':
            message_handler?.(event.data, (conduit.$kind === 'node') ? conduit.netid : event.node_netid, conduit);  
            break;
        case 'leave':
            leave_handler?.(event.node_netid, conduit);
            break;
        default:
            console.error('conduit_iterate: Unknown event type:', event.type);
            break;
        }
    }
}

conduitNetwork.conduit_close = function conduit_close(conduit) {
    // Conduit was still alive, update it to offline
    conduit.$status = 'closed';
    
    if (conduit.$kind === 'group') {
        // For group conduits, add all connected peers to leave queue and close connections
        for (const peer_netid in conduit.$peer_dataconnection_table) {
            const dataconnection = conduit.$peer_dataconnection_table[peer_netid];
            if (dataconnection) {
                // Add to leave queue
                conduit.$event_queue.push({type: 'leave', node_netid: peer_netid});
                
                // Close the PeerJS connection if not already closed
                if (dataconnection.open) {
                    dataconnection.close();
                }
            }
        }

        conduit.$peer_dataconnection_table = {};
        
        // Close discovery server connection if it exists
        if (conduit.$discovery_dataconnection && conduit.$discovery_dataconnection.open) {
            conduit.$discovery_dataconnection.close();
            conduit.$discovery_dataconnection = null;
        }
        
    } else if (conduit.$kind === 'node') {
        // For single conduits, add all connected peers to leave queue and close connections
        for (const peer_netid in conduit.$peer_dataconnection_table) {
            const dataconnection = conduit.$peer_dataconnection_table[peer_netid];
            if (dataconnection) {
                // Add to leave queue
                conduit.$event_queue.push({type: 'leave', node_netid: peer_netid});
                
                // Close the PeerJS connection if not already closed
                if (dataconnection.open) {
                    dataconnection.close();
                }
            }
        }
        
        // Clear the peer table
        conduit.$peer_dataconnection_table = {};
        
    }
        
    // Remove this conduit's WeakRef from the set
    for (const conduitRef of conduitNetwork.open_conduits) {
        if (conduitRef.deref() === conduit) {
            conduitNetwork.open_conduits.delete(conduitRef);
            break;
        }
    }
}


/* Close all connections and reset to the uninitialized state. */
conduitNetwork.reset_conduits = function reset_conduits(preserve_id) {
    if (conduitNetwork.reconnect_timer) {
        clearTimeout(conduitNetwork.reconnect_timer);
        conduitNetwork.reconnect_timer = null;
    }

    // Close all open conduits
    for (const conduitRef of conduitNetwork.open_conduits) {
        const conduit = conduitRef.deref();
        if (conduit) {
            conduitNetwork.conduit_close(conduit);
        }
    }
    
    // Clear the open conduits set
    conduitNetwork.open_conduits.clear();
    
    // Clear the pending queue
    conduitNetwork.work_queue.length = 0;
    
    // Clear pending single connections
    conduitNetwork.listen_queue.length = 0;
    
    // Clear pending discovery connections
    conduitNetwork.pending_discovery_connections = {};
    
    // Close the main peer connection if it exists
    if (conduitNetwork.peer) {
        conduitNetwork.peer.destroy();
        conduitNetwork.peer = null;
    }
    
    // Reset status but maybe allow the old node netid to persist
    conduitNetwork.status = 'uninitialized';
    conduitNetwork.game_uuid = null;
    if (! preserve_id) {
        conduitNetwork.node_netid = null;
    }
}



function netid_to_peerid(netid) {
    // Create a valid PeerJS ID using base64 encoding for reversibility
    // PeerJS IDs can contain alphanumeric characters, hyphens, and underscores
    const combined = netid + conduitNetwork.game_uuid;
    
    // Use base64 encoding and make it PeerJS-safe
    const encoded = btoa(combined)
        .replace(/\+/g, '-')    // Replace + with -
        .replace(/\//g, '_')    // Replace / with _
        .replace(/=/g, '');     // Remove padding =
    
    // Ensure it starts with a letter (prepend 'q' if it starts with a number)
    const validId = /^[a-zA-Z]/.test(encoded) ? encoded : 'q' + encoded;
    
    return validId;
}

// =============================================================================
// Helper functions not in the public API
// =============================================================================


/* Register an incoming peer connection and set up its handlers */
function register_incoming_connection(peerjs_dataconnection) {
    const peer_id = peerjs_dataconnection.peer;
    const from_netid = peerid_to_netid(peer_id);
    
    // Find the single conduit that should handle this connection using metadata
    let target_conduit = null;
    const conduit_netid = peerjs_dataconnection.metadata?.conduit_netid;
    
    if (! conduit_netid) {
        conduitNetwork.log('No conduit_netid in connection metadata from:', peer_id);
        return;
    }
    
    // Check if this is a single conduit connection (references this node's own netid)
    if (conduit_netid === conduitNetwork.node_netid) {
        conduitNetwork.listen_queue.push({
            peerjs_dataconnection: peerjs_dataconnection,
            from_netid: from_netid,
            conduit_netid: conduit_netid
        });
        return;
    }
    
    // Find the conduit with matching netid (for group conduits)
    for (const conduitRef of conduitNetwork.open_conduits) {
        const conduit = conduitRef.deref();
        if (conduit && conduit.netid === conduit_netid) {
            target_conduit = conduit;
            break;
        }
    }
    
    if (! target_conduit) {
        conduitNetwork.log('No conduit found for netid:', conduit_netid, 'from peer:', peer_id);
        return;
    }
    
    console.assert(! target_conduit.$peer_dataconnection_table[from_netid]);
    target_conduit.$event_queue.push({type: 'join', node_netid: from_netid});
    
    target_conduit.$peer_dataconnection_table[from_netid] = peerjs_dataconnection;
    peerjs_dataconnection.on('data', makeMessageHandler(target_conduit, from_netid));
    peerjs_dataconnection.on('close', makeCloseHandler(target_conduit, from_netid));
    peerjs_dataconnection.on('error', makeErrorHandler(target_conduit, from_netid));
}


/* 
   Attempt to connect to the discovery server for the given group netid.
   Handles all connection logic, timeouts, and fallback internally.
   */
function connect_to_discovery_server(conduit, group_netid) {
    console.log('connect_to_discovery_server', group_netid);
    const discovery_server_peerjs_id = netid_to_peerid(group_netid);

    // Register this connection attempt in the pending table for centralized error handling
    conduitNetwork.pending_discovery_connections[discovery_server_peerjs_id] = conduit;

    // The connection to the discovery server
    conduit.$discovery_dataconnection = conduitNetwork.peer.connect(discovery_server_peerjs_id, {reliable: true, metadata: {}});

    // Success handler
    conduit.$discovery_dataconnection.on('open', function () {
        clearTimeout(timeoutId);
        conduitNetwork.log('Connected to discovery server');

        // Remove from pending table since connection succeeded
        delete conduitNetwork.pending_discovery_connections[discovery_server_peerjs_id];
        
        // Set up the data handler to receive peer list
        conduit.$discovery_dataconnection.on('data', function (peer_list) {
            conduitNetwork.log('Received peer list from discovery server:', peer_list);
            // Connect to all peers that we don't already know about
            for (const node_netid of peer_list) {
                if (! conduit.$peer_dataconnection_table[node_netid]) {
                    connect_to_peer(conduit, node_netid);
                    // Enqueue join event for discovered peer
                    conduit.$event_queue.push({type: 'join', node_netid: node_netid});
                }
            }
            
            // Change status when peer list arrives (even if empty)
            conduit.$status = 'online';
            conduitNetwork.log('Conduit status changed to online. Connected to', peer_list.length, 'peers');
        });
    });


    // Explicit timeout since PeerJS connections appear to sometimes hang without firing failure callbacks
    const timeoutId = setTimeout(function discoveryTimeout() {
        if (conduit.$status === 'pending') {
            // Create a timeout error that matches PeerJS error structure and call our error handler directly
            conduit.$discovery_error_callback({
                type: 'network',
                message: 'Connection timeout after ' + conduitNetwork.DISCOVERY_CONNECTION_TIMEOUT_SECONDS + ' seconds'
            });
        }
    }, conduitNetwork.DISCOVERY_CONNECTION_TIMEOUT_SECONDS * 1000);


    conduit.$discovery_error_callback = function (err) {
        clearTimeout(timeoutId);
        // By the time that this error arrived, the connection attempt was no longer pending
        if (conduit.$status === 'closed') {
            console.log('Ignored discovery server error after conduit was closed');
            return;
        }

        // Clean up the failure and try again
        if (conduit.$discovery_dataconnection) {    
            conduit.$discovery_dataconnection.close();
            conduit.$discovery_dataconnection = null;
            delete conduitNetwork.pending_discovery_connections[discovery_server_peerjs_id];
        }

        if (conduitNetwork.status === 'offline') {
            conduitNetwork.log('Could not connect to discovery server because this node is offline. Scheduling connection retry.');
            // Queue another connection attempt for when the node comes online
            conduitNetwork.work_queue.push(function() {
                connect_to_discovery_server(conduit, group_netid);
            });

        } else {
            // Handle fallback logic with appropriate delay
            setTimeout(function discoveryServerTakeover() {
                    conduitNetwork.log('Could not connect to discovery server because it does not exist. Attempting to launch the discovery server on this node and scheduling connection retry.');

                    // Try to launch a discovery server, and then retry connection
                    launch_discovery_server(conduit, group_netid, function() {
                        // Re-attempt to connect to the discovery server, which may be on this node now
                        setTimeout(function discoveryInitialReconnect() {
                            connect_to_discovery_server(conduit, group_netid);
                        }, conduitNetwork.DISCOVERY_INITIAL_RECONNECT_DELAY_SECONDS * 1000);
                    });
                },
                // Wait a random amount of time before trying to reconnect, since
                // every node in the network is going to try to reconnect and then set up
                // its own server when that fails. This reduces the contention for the takeover.
                Math.random() * conduitNetwork.DISCOVERY_SERVER_TAKEOVER_MAX_DELAY_SECONDS * 1000);
        }
    };

    // Register the error handler with PeerJS
    conduit.$discovery_dataconnection.on('error', conduit.$discovery_error_callback);

    conduit.$discovery_dataconnection.on('close', function () {
        if (conduit.$status === 'closed') {
            console.log('Ignored discovery server connection close since conduit is already closed')
            return;
        }
        
        conduitNetwork.log('Discovery server connection closed');
        conduit.$discovery_dataconnection = null;

        // Try to reconnect to the discovery server, without a join packet
        connect_to_discovery_server(conduit, group_netid);
    });
}


/* Helper function to connect to a peer and set up message handling. */
function connect_to_peer(conduit, node_netid) {
    let connection = conduit.$peer_dataconnection_table[node_netid];
    
    if (connection) {
        // Already connected
        return connection; 
    }

    connection = conduitNetwork.peer.connect(netid_to_peerid(node_netid), {
        reliable: true,
        metadata: { conduit_netid: conduit.netid }
    });

    conduit.$peer_dataconnection_table[node_netid] = connection;
    connection.on('data', makeMessageHandler(conduit, node_netid));
    connection.on('close', makeCloseHandler(conduit, node_netid));
    connection.on('error', makeErrorHandler(conduit, node_netid));

    connection.on('open', function() {
        if (conduit.netid === node_netid) {
            // Single conduit
            conduit.$status = 'open';
        }
    });

    return connection;
}


/* Helper function to launch a discovery server for the given group netid. After the
   attempt has either failed or succeeded, the callback is called. */
function launch_discovery_server(conduit, group_netid, callback) {
    conduitNetwork.log(`Attempting to create discovery server for "<code>${group_netid}</code>"`);
    
    // Store the discovery server state in the conduit to prevent garbage collection
    conduit.$discovery_server = {
        peer: new Peer(netid_to_peerid(group_netid)),
        client_table: {}
    };
    
    conduit.$discovery_server.peer.on('open', function (peerjs_id) {
        conduitNetwork.log(`Successfully created discovery server for "<code>${group_netid}</code>"`);
        if (callback) { callback(); }
    });
    
    conduit.$discovery_server.peer.on('error', function(err) {
        if (err.type === 'unavailable-id') {
            conduitNetwork.log('Failed to create discovery server - ID already taken');
        } else {
            conduitNetwork.log('Discovery server error:', err);
        }
        if (callback) { callback(); }
    });
    
    conduit.$discovery_server.peer.on('connection', function(connection) {
        connection.on('open', function() {
            // Send the new client the list of OTHER client netids
            connection.send(Object.keys(conduit.$discovery_server.client_table));
            
            // Record this peer to send to others in the future (use netid as key)
            conduit.$discovery_server.client_table[peerid_to_netid(connection.peer)] = connection;
        });
        
        connection.on('close', function() {
            // The client left, so clean up
            delete conduit.$discovery_server.client_table[peerid_to_netid(connection.peer)];
        });
        
        connection.on('error', function(err) {
            conduitNetwork.log('Discovery server client connection error:', err);
            delete conduit.$discovery_server.client_table[peerid_to_netid(connection.peer)];
        });
    });
}


// Lost signalling server
function handle_network_disconnection() {
    // Set network status to offline
    conduitNetwork.status = 'offline';

    if (conduitNetwork.reconnect_timer === null) {
        conduitNetwork.reconnect_timer = setInterval(function() {
            if (conduitNetwork.status === 'offline') {
                conduitNetwork.peer.reconnect();
            } else {
                conduitNetwork.log('Received timer callback for reconnecting while not offline');
                clearInterval(conduitNetwork.reconnect_timer);
                conduitNetwork.reconnect_timer = null;
            }
        }, conduitNetwork.NETWORK_RECONNECT_DELAY_SECONDS * 1000);
    }
}


// Reconnected to signalling server
function handle_network_reconnection() {
    // Set network status to online
    conduitNetwork.status = 'online';

    if (conduitNetwork.reconnect_timer !== null) {
        clearInterval(conduitNetwork.reconnect_timer);
        conduitNetwork.reconnect_timer = null;
    }
}


function makeErrorHandler(conduit, node_netid) {
    return function(err) {
        conduitNetwork.log('Peer connection error:', err, 'for peer:', node_netid);
        delete conduit.$peer_dataconnection_table[node_netid];
    };
}


function makeMessageHandler(conduit, node_netid) {
    return function (data) {
        conduit.$event_queue.push({
            type: 'message',
            node_netid: node_netid,
            data: deserialize(data, quadplaySerializeUntransform)
        });
    };
}


function makeCloseHandler(conduit, node_netid) {
    return function() {
        delete conduit.$peer_dataconnection_table[node_netid];
        conduit.$event_queue.push({type: 'leave', node_netid: node_netid});
    };
}


function peerid_to_netid(peerid) {
    try {
        // Reverse the transformation from netid_to_peerid
        let encoded = peerid;
        
        // Remove the 'q' prefix if it was added
        if (encoded.startsWith('q') && encoded.length > 1 && /^[0-9]/.test(encoded.charAt(1))) {
            encoded = encoded.substring(1);
        }
        
        // Restore base64 format
        const base64 = encoded
            .replace(/-/g, '+')     // Restore + from -
            .replace(/_/g, '/')     // Restore / from _
            + '==='.substring(0, (4 - encoded.length % 4) % 4); // Add padding
        
        // Decode and extract netid
        const combined = atob(base64);
        const netid = combined.substring(0, combined.length - conduitNetwork.game_uuid.length);
        
        return netid;
    } catch (error) {
        // If decoding fails, fall back to stored netid
        return conduitNetwork.node_netid || '';
    }
}

// =============================================================================
// DEBUG-ONLY FUNCTION EXPORTS - BREAK API ABSTRACTION
// =============================================================================
// These expose internal helper functions for debugging purposes only.

conduitNetwork.debug_peerid_to_netid = peerid_to_netid;
conduitNetwork.debug_netid_to_peerid = netid_to_peerid;

}
