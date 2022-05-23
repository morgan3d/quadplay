
function make_bot_gamepad(color, name, index) {

    const gamepad = {
        $x: 0, $y: 0, $dx: 0, $dy: 0,
        $angle: 0, $dangle: 0,
        a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, $p: 0, q: 0,
        aa: 0, bb: 0, cc: 0, dd: 0, ee: 0, ff: 0, $pp: 0, qq: 0,
        pressed_a: 0, pressed_b: 0, pressed_c: 0, pressed_d: 0, pressed_e: 0, pressed_f: 0, $pressed_p: 0, pressed_q: 0,
        released_a: 0, released_b: 0, released_c: 0, released_d: 0, released_e: 0, released_f: 0, $released_p: 0, released_q: 0,
        $status: "bot",
        index: index,
        online_name: name || "bot",
        player_color: Object.freeze(color === undefined ? gray(0.8) : clone(color)),
        prompt: Object.freeze(Object.assign({'##': 'AI'}, $controlSchemeTable.Quadplay)),
        type: "Quadplay"
    };
    
    $bind_gamepad_getters(gamepad);

    return Object.seal(gamepad);
}


function update_bot_gamepad(gamepad, controls, absolute) {
    const buttons = 'abcdefq';

    for (let i = 0; i < buttons.length; ++i) {
        const b = buttons[i];
        
        const old_val = gamepad[b] ? 1 : 0;
        const new_val = controls[b] ? 1 : 0;

        gamepad['released_' + b] = (old_val && ! new_val) ? 1 : 0;
        gamepad[b + b] = gamepad['pressed_' + b] = (new_val && ! old_val) ? 1 : 0;
        gamepad[b] = new_val;
    }

    const axes = 'xy';
    for (let i = 0; i < axes.length; ++i) {
        const a = axes[i];

        const new_val = controls[a] === undefined ?
              0 : 
              $Math.max($Math.min(controls[a], 1), -1) *
              (a === 'x' || absolute ? 1 : -up_y());
        
        const old_val = gamepad['$' + a];

        gamepad['$d' + a] = new_val - old_val;
        gamepad['$' + a + a] = (old_val === 0) ? new_val : 0;;
        gamepad['$' + a] = new_val;
    }

    // Logic copied from quadplay-browser.js
    const oldAngle = gamepad.$angle;
    if ((gamepad.$y !== 0) || (gamepad.$x !== 0)) {
        gamepad.$angle = $Math.atan2(-gamepad.$y, gamepad.$x);
    }

    if ((gamepad.$y === gamepad.$dy && gamepad.$x === gamepad.$dx) || (gamepad.$y === 0 && gamepad.$x === 0)) {
        gamepad.$dangle = 0;
    } else {
        // JavaScript operator % is a floating-point operation
        gamepad.$dangle = ((3 * Math.PI + gamepad.$angle - oldAngle) % (2 * Math.PI)) - Math.PI;
    }
}


function $game_tree_compute_children(sgn, game_state, generate_moves, make_move, unpredictability, static_evaluate) {
    // Generate and statically rate all moves
    const child_array = generate_moves(game_state);
    
    for (let i = 0; i < child_array.length; ++i) {
        const move = child_array[i];
        const new_game_state = make_move(game_state, move);
        let new_static_value = static_evaluate(new_game_state);

        if (new_static_value !== "draw") {
            new_static_value += random(0, unpredictability);
        }
            
        child_array[i] = {
            move: move,
            game_state: new_game_state,
            static_value: new_static_value};
    }
            
    // Look at good moves first as a time optimization
    sort(child_array, "static_value", sgn > 0);
    
    return child_array;
}    


function $ai_score_to_string(score) {
    if ($Math.abs(score) === Infinity) {
        return unparse(score);
    } else if (is_string(score)) {
        return score;
    } else {
        return format_number(score, "0.00");
    }
}


/* Positive is always good for player sgn and negative is always bad for that player. 

   Negamax w/ alpha-beta pruning:
   http://www.hamedahmadi.com/gametree/#negamax
*/
function* $game_tree_value(depth, my_worst, their_best, sgn, static_value, game_state, generate_moves, make_move, unpredictability, static_evaluate, debug_indent, debug_move_to_string, progress_start, progress_increment) {
    // Leaf nodes of the game tree
    if (static_value === "draw") { 
        return {move: undefined, value: 0};
    }
        
    if (depth === 0 || $Math.abs(static_value) === Infinity) { 
        return {move: undefined, value: sgn * static_value};
    }

    // Internal nodes
    const child_array = $game_tree_compute_children(sgn, game_state, generate_moves, make_move, unpredictability, static_evaluate);

    // If any move is a guaranteed win for me, just take it before
    // exploring the rest of the tree. Otherwise the AI might try to
    // protect against a loss before it will take an obvious win.
    for (let c = 0; c < child_array.length; ++c) {
        const child = child_array[c];
        if (child.static_value === sgn * Infinity) {
            if (debug_move_to_string){
                debug_print(undefined, debug_indent + debug_move_to_string(child.move) + ": static = " + $ai_score_to_string(child.static_value));
            }
            return {move: child.move, value: sgn * child.static_value};
        }
    }

    // Find the highest α achievable for this player
    const best = {value: -Infinity, move: child_array[0].move};

    progress_increment /= child_array.length;
    for (let c = 0; c < child_array.length; ++c) {
        const progress = progress_start + c * progress_increment;
        yield progress;
        
        const child = child_array[c];
        
        if (debug_move_to_string){
            debug_print(undefined, debug_indent + debug_move_to_string(child.move) + ': static = ' + $ai_score_to_string(child.static_value));
        }

        // How well can we do with this move? The opposite of how well the other player can
        // do on their next move.
        const value = -(yield* $game_tree_value(depth - 1, -their_best, -my_worst, -sgn, child.static_value, child.game_state, generate_moves, make_move, unpredictability, static_evaluate, debug_indent + '. ', debug_move_to_string, progress, progress_increment)).value;
        
        if (value > best.value) {
            best.value = value;
            best.move = child.move;
        }
        
        my_worst = $Math.max(best.value, my_worst);
        
        // α-Cutoff (this is what makes the search fast)
        if (my_worst >= their_best) {
            return {move: child.move, value: my_worst};
        }

        // Free already-used node resources
        child.move = undefined;
        child.game_state = undefined;
    }
    
    return best;
}


function* $find_move(player_index, game_state, generate_moves, make_move, static_evaluate, max_depth, unpredictability, debug_move_to_string) {
    if (debug_move_to_string) {
        debug_print(undefined, `=================================\nfind_move(), max_depth = ${max_depth}, unpredictability = ${unpredictability}\n`);
    }

    const sgn = 1 - 2 * player_index;
    const best = yield* $game_tree_value(max_depth, -Infinity, Infinity, sgn, NaN, game_state, generate_moves, make_move, unpredictability, static_evaluate, '? ', debug_move_to_string, 0, 1);

    if (best.value === -Infinity && max_depth > 1) {
        // The best this player can do is lose. If the opponent is
        // perfect, then it doesn't matter what the player
        // does. However, if the opponent is imperfect, chosing a move
        // that improves the static position is better if the opponent
        // is imperfect. Examine all depth 1 positions again and take the first
        const child_array = $game_tree_compute_children(sgn, game_state, generate_moves, make_move, unpredictability, static_evaluate);
        best.move = child_array[0].move;
        best.value = sgn * child_array[0].static_value;
        if (debug_move_to_string) { debug_print(undefined, 'All moves lead to loss. Fallback: Go down fighting!'); }
    }
    
    // Show total value of this move
    if (debug_move_to_string) {
        debug_print(undefined, '--------------------------------\nbest for me: ' + debug_move_to_string(best.move) + ' = ' + $ai_score_to_string(best.value) + ' after ' + max_depth + ' moves\n=================================');
    }
        
    return best.move;
}


function make_move_finder(player_index, game_state, generate_moves, make_move, static_evaluate, max_depth = 2, unpredictability = 0, debug_move_to_string = undefined) {
    const f = $find_move(player_index, game_state, generate_moves, make_move, static_evaluate, max_depth, unpredictability, debug_move_to_string, 0, 1);

    return function (time = 1 / 240) {
        const end = now() + time;

        let progress = 0;
        do {
            const r = f.next();
            if (r.done) {
                return {progress: 1, move: r.value};
            } else {
                progress = r.value;
            }
        } while (now() < end);
        
        return {progress: progress};
    };
}


function find_move(player_index, game_state, generate_moves, make_move, static_evaluate, max_depth = 2, unpredictability = 0, debug_move_to_string = undefined) {
    return make_move_finder(player_index, game_state, generate_moves, make_move, static_evaluate, max_depth, unpredictability, debug_move_to_string = undefined)(Infinity).move;
}


////////////////////////////////////////////////////////////////////////////////////////
//
// Path-finding
//
//

function map_find_path(map, start, goal, edgeCost, costLayer, use_sprite_id) {
    if (use_sprite_id === undefined) { use_sprite_id = true; }
    
    if (is_array(edgeCost)) {
        // Create an edgeTable
        const edgeTable = new Map();
        for (let i = 0; i < edgeCost.length; i += 2) {
            edgeTable.set(use_sprite_id ? edgeCost[i].id : edgeCost[i], edgeCost[i + 1]);
        }
        
        edgeCost = function (A, B, m) {
            const sprite = get_map_sprite(map, B, costLayer);
            if (sprite === undefined) { return 1; }
            const cost = edgeTable.get(use_sprite_id ? sprite.id : sprite);
            return (cost === undefined) ? 1 : cost;
        };
    }

    function estimatePathCost(A, B, m) {
        let dx = $Math.abs(A.x - B.x);
        let dy = $Math.abs(A.y - B.y);
        if (map.loop_x) { dx = $Math.min(dx, map.size.x - 1 - dx); }
        if (map.loop_y) { dy = $Math.min(dy, map.size.y - 1 - dy); }
        return dx + dy;
    }

    function getNeighbors(node, m) {
        const neighbors = [];
        if (node.x > 0) {
            neighbors.push({x:node.x - 1, y:node.y});
        } else if (map.loop_x) {
            neighbors.push({x:map.size.x - 1, y:node.y});
        }

        if (node.x < map.size.x - 1) {
            neighbors.push({x:node.x + 1, y:node.y});
        } else if (map.loop_x) {
            neighbors.push({x:0, y:node.y});
        }

        if (node.y > 0) {
            neighbors.push({x:node.x, y:node.y - 1});
        } else if (map.loop_y) {
            neighbors.push({x:node.x, y:map.size.y - 1});
        }

        if (node.y < map.size.y + 1 - 1) {
            neighbors.push({x:node.x, y:node.y + 1});
        } else if (map.loop_y) {
            neighbors.push({x:node.x, y:0});
        }
        
        return neighbors;
    }

    return find_path(floor(start), floor(goal), estimatePathCost, edgeCost, getNeighbors, function (N) { return N.x + N.y * map.size.x * 2; }, map);
}

// For backwards compatibility 
var find_map_path = map_find_path;


/** Used by find_path */
function $Step(last, startCost, goalCost) {
    this.last          = last;
    this.previous      = null;
    this.costFromStart = startCost;
    this.costToGoal    = goalCost;
    this.inQueue       = true;
}

/** Used by find_path */
$Step.prototype.cost = function() {
    return this.costFromStart + this.costToGoal;
}

// A PriorityQueue is a queue that can arranges elements by cost
// instead of arrival order

function $PriorityQueue() {
    this.elementArray = [];
    this.costArray    = [];
}


/** Number of elements in the queue */
$PriorityQueue.prototype.length = function() {
    return this.elementArray.length;
}


/** Assumes that element is not already in the queue */
$PriorityQueue.prototype.insert = function(element, cost) {
    this.elementArray.push(element);
    this.costArray.push(cost);
}


/** Erases the queue */
$PriorityQueue.prototype.clear = function() {
    this.elementArray = [];
    this.costArray    = [];
}


/** Updates the cost of element in the queue */
$PriorityQueue.prototype.update = function(element, newCost) {
    const i = this.elementArray.indexOf(element);

    if (i === -1) {
        $error("" + element + " is not in the PriorityQueue");
    }

    this.costArray[i] = newCost;
}


/** Removes the minimum cost element and returns it */
$PriorityQueue.prototype.removeMin = function() {
    if (this.elementArray.length === 0) {
        $error("PriorityQueue is empty");
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
    
