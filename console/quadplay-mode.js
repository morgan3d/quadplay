"use strict";
/** Called from visualizeModes(). 
 
    Attempts to resolve intersections if
    these arrays of points cross each other. Treats them as polylines
    for simpler intersection determination even though we actually
    render using quadratic beziers. These could be subdivided if more
    accuracy was important, but since this function is only used for
    some layout heuristics, that is not currently justified. */
function resolveModeGraphEdgeIntersection(pointsA, dirA, pointsB, dirB) {
    // dirA/B are +/-1 for the iteration direction. If positive, then
    // the shared endpoint (at which to swap) is at index 0, otherwise
    // it is at index n
    // Compare all sublines
    let intersect = false;
    for (let i = 0; (i < pointsA.length - 1) && ! intersect; ++i) {
        for (let j = 0; (j < pointsB.length - 1) && ! intersect; ++j) {
            intersect = linesIntersect(pointsA[i], pointsA[i + 1], pointsB[j], pointsB[j + 1]);
        } // j
    } // i

    if (intersect) {
        // Indices of the points nearest the shared node
        const a = (dirA === 1) ? 0 : pointsA.length - 1;
        const b = (dirB === 1) ? 0 : pointsB.length - 1;

        // Swap two end points
        const temp = pointsA[a]; pointsA[a] = pointsB[b]; pointsB[b] = temp;

        // Remove any intermediate point that comes immediately before these
        // end points in a curve. This is an attempt to straighten the line
        // near the shared node while avoiding creating collisions with other nodes.
        if (pointsA.length > 2) { pointsA.splice(a + dirA, 1) }
        if (pointsB.length > 2) { pointsB.splice(b + dirB, 1) }
    }
}


/** Returns true if line segment AC intersects BD */
function linesIntersect(A, C, B, D) {
    // Simplified from https://github.com/pgkelley4/line-segments-intersect/blob/master/js/line-segments-intersect.js
    // by ignoring the parallel cases
    
    const dA = QRuntime.$sub(C, A);
    const dB = QRuntime.$sub(D, B);
    const diff = QRuntime.$sub(B, A);

    const numerator = QRuntime.cross(diff, dA);
    const denominator = QRuntime.cross(dA, dB);

    if (Math.max(Math.abs(denominator), Math.abs(numerator)) < 1e-10) {
        // Parallel cases
        return false;
    }

    const u = numerator / denominator;
    const t = QRuntime.cross(diff, dB) / denominator;

    // Intersect within the segments
    return (t >= 0) && (t <= 1) && (u >= 0) && (u <= 1);
}

/** Convert a source location (url and line number) to a mode graph edge ID */
function sourceLocationToModeGraphEdgeId(url, lineNumber) {
    return (!url) ?
        'mode_graph_edge_start' :
        `mode_graph_edge_${url.replace(/[^A-Za-z0-9_\-\.]/g, '_')}_${lineNumber}`;
}

/** Convert a mode name to a mode graph mode ID */
function modeNameToModeGraphModeId(modeName) {
    return `mode_graph_mode_${modeName.replace(/[^A-Za-z0-9_\-\.]/g, '_')}`;
}

/** Generates an SVG visualization of the game's mode graph.

Key assumptions:
- gameSource.modes contains all game modes with their names and URLs
- gameSource.json.start_mode is set to a valid mode name
- fileContents contains the source code for all modes
- dagre library is loaded

Global state dependencies:
- Reads: gameSource, fileContents
- Writes: modeEditor.innerHTML
- May call: setErrorStatus() if start mode is missing or invalid mode references found

The visualization uses a color scheme based on node position in the graph,
with special handling for the 'Play' mode node. Edge colors are inherited
from their source nodes.
*/
function visualizeModes(modeEditor) {
    // dagre API: https://github.com/dagrejs/graphlib/wiki/API-Reference#graph-api
    
    function nodeToHTMLColor(node) {
        if (node.label === 'Play') {
            // Force the Play node to white. It is almost always near
            // the center of the graph and nearly white anyway, but
            // this improves contrast.
            return '#fff';
        }
        
        const x = Math.min(1, Math.max(0, 1.6 * node.x / graph._label.width - 0.27));
        const y = Math.min(1, Math.max(0, 1.5 * node.y / graph._label.height - 0.25));

        // Use a Red-Cyan-Yellow color wheel
        let r = Math.max(Math.sqrt(1 - x), Math.max(2 * y - 0.8, 0));
        let g = Math.max(Math.sqrt((x * 0.95 + 0.05) * y), 0.6 * Math.pow(Math.max(2 * (1 - y) - 1, 0), 2));
        let b = Math.sqrt((x * 0.95 + 0.05) * Math.sqrt(1.1 - y));

        // Boost around the green primary
        g += 0.5 * x * Math.max(0, (1 - Math.abs(y - 0.6) * 2));
        
        // Maximize value
        const m = Math.max(r, g, b);
        r /= m; g /= m; b /= m;

        // Decrease saturation
        const s = 0.65;
        // Code to decrease saturation radially, no longer needed now that
        // we special-case the "Play" mode:
        //  s = Math.min(1, Math.pow(Math.hypot(x - 0.5, y - 0.5), 2) * 1.7);

        // Reduce saturation and convert to [0, 255]
        r = Math.round((r * s + (1 - s)) * 255);
        g = Math.round((g * s + (1 - s)) * 255);
        b = Math.round((b * s + (1 - s)) * 255);
        return `rgb(${r}, ${g}, ${b})`;
    }
    
    // Get nodes
    const nodeArray = [], nodeTable = {};
    let startNode = null;
    for (let m = 0; m < gameSource.modes.length; ++m) {
        const mode = gameSource.modes[m];
        // Skip system modes
        if (mode.name[0] === '$') { continue; }

        const isStart = (gameSource.json.start_mode === mode.name);
        const node = {name: mode.name, label: mode.name, edgeArray:[], isStart:isStart};
        if (isStart) { startNode = node; }
        nodeArray.push(node);
        nodeTable[mode.name] = node;
    }

    if (! startNode) {
        setErrorStatus('No start mode specified.');
        return;
    }

    const setModeRegexp = /\b(set_mode|push_mode)\s*\(([^,_)]+)(?:.*)\)(?:\s*because\s*"([^"\n]*)")?/g;
    const reset_gameRegexp = /\breset_game\s*\(.*\)(?:\s*because\s*"([^"\n]*)")?/g;

    // Modes that have links back to their parent mode, whether
    // entered by set_mode or push_mode. These have to be processed
    // after all other links are discovered.
    let backLinks = [];
    
    // Get edges for each node
    for (let m = 0; m < gameSource.modes.length; ++m) {
        const mode = gameSource.modes[m];
        const name = mode.name.replace(/^.*\/|\*/g, '');
        // Skip system modes
        if (name[0] === '$') { continue; }
        const code = fileContents[mode.url];

        const edgeArray = nodeTable[name].edgeArray;
        for (let match = setModeRegexp.exec(code), lineNumber = 1, lastIndex = 0; 
            match;
            match = setModeRegexp.exec(code)) {
            
            // Count newlines between last match and current match so that we can assign a line number
            lineNumber += (code.slice(lastIndex, match.index).match(/\n/g) || []).length;
            lastIndex = match.index;

            const to = nodeTable[match[2]];
            if (to) {
                edgeArray.push({to: to, label: match[3], type: match[1], url: mode.url, lineNumber: lineNumber});
            } else {
                setErrorStatus(mode.url + ': set_mode to nonexistent mode ' + match[2]);
                return;
            }
        } // for each set_mode statement

        // Don't bother using efficient line number 
        for (let match = reset_gameRegexp.exec(code); match; match = reset_gameRegexp.exec(code)) {
            edgeArray.push({to: startNode, label: match[1], type: 'reset_game', url: mode.url, lineNumber: code.substring(0, match.index).split('\n').length});
        } // for each set_mode statement
    } // for each mode

    //////////////////////////////////////////////////////////////////////////////////////
    // Convert to the layout API
    const graph = new dagre.graphlib.Graph({directed:true, multigraph:true});
    const nodeWidth = 120, nodeHeight = 28;
    // https://github.com/dagrejs/dagre/wiki#configuring-the-layout
    graph.setGraph({rankdir: 'TB', ranksep: 70});
    graph.setDefaultEdgeLabel(function() { return {}; });

    // Add the $START node
    graph.setNode('$START', {
        label: '$START',
        width: nodeWidth,
        height: nodeHeight,
        isStart: true
    });

    let edgeId = 0;
    for (let n = 0; n < nodeArray.length; ++n) {
        const node = nodeArray[n];
        // Make the play node a little larger than the others
        const scale = (node.label === 'Play') ? 1.3 : 1.0;
        graph.setNode(node.name,
                      {label:    node.label,
                       width:    scale * nodeWidth,
                       height:   scale * nodeHeight,
                       isStart:  node.isStart,
                       mode:     gameSource.modes.find(mode => mode.name === node.label)});

        // Add edge from $START to the start mode
        if (node.isStart) {
            graph.setEdge('$START', node.name,
                {label: '',
                 width: 20,
                 height: 10,
                 labelpos: 'c'
                }, 'edge' + edgeId);
            ++edgeId;
        }

        for (let e = 0; e < node.edgeArray.length; ++e) {
            const edge = node.edgeArray[e];
            graph.setEdge(node.name, edge.to.name,
                          {label:     edge.label,
                           width:     edge.label ? edge.label.length * 5 : 0,
                           height:    10,
                           labelpos:  'c',
                           bidir:     (edge.type === 'push_mode'),
                           url:       edge.url,
                           lineNumber:edge.lineNumber
                          }, 'edge' + edgeId);
            ++edgeId;
        }
    }
    
    // Compute layout on the mode graph
    dagre.layout(graph);

    // Render the mode graph to SVG
    let svg = `<svg class="modeGraph" width=${graph._label.width + 40} height=${graph._label.height + 60} viewbox="-20 -30 ${graph._label.width + 40} ${graph._label.height + 100}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`;
    svg += `<defs><filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="2" y="-25%" height="150%" flood-opacity="0.5" filterUnits="userSpaceOnUse"/></filter>
<filter id="outerglow">
<feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-opacity="1.0" flood-color="#302b2b" filterUnits="userSpaceOnUse"/>
<feDropShadow dx="0" dy="0" stdDeviation="1" flood-opacity="1.0" flood-color="#302b2b" filterUnits="userSpaceOnUse"/>
<feDropShadow dx="0" dy="0" stdDeviation="1" flood-opacity="1.0" flood-color="#302b2b" filterUnits="userSpaceOnUse"/>
<feDropShadow dx="0" dy="0" stdDeviation="2" flood-opacity="1.0" flood-color="#302b2b" filterUnits="userSpaceOnUse"/>
</filter>

<filter id="whiteglow" filterUnits="userSpaceOnUse" x="-50%" y="-50%" width="200%" height="200%">
  <feFlood flood-color="white" flood-opacity="5" result="white"/>
  <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="blur"/>
  <feComposite in="white" in2="blur" operator="in" result="whiteBlur"/>
  <feComposite in="SourceGraphic" in2="whiteBlur" operator="over"/>
</filter>

<filter id="whiteglow-edge" filterUnits="userSpaceOnUse" x="-50%" y="-50%" width="200%" height="200%">
  <feFlood flood-color="white" flood-opacity="5" result="white"/>
  <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur"/>
  <feComposite in="white" in2="blur" operator="in" result="whiteBlur"/>
  <feComposite in="SourceGraphic" in2="whiteBlur" operator="over"/>
</filter>
</defs>`

    // If there are two edges that share a node which cross each other
    // when rendered, see if swapping their rendering endpoints eliminates
    // the crossing. This tends to occur because incoming edges always
    // go to the bottom of nodes and outgoing edges always go to the top.

    graph.nodes().forEach(function(n) {
        const edges = graph.nodeEdges(n);
        edges.forEach(function(e1) {
            const edge1 = graph.edge(e1);
            edges.forEach(function(e2) {
                const edge2 = graph.edge(e2);
                // Only perform comparisons one way; use the Y axis to arbitrarily distingish order
                if ((e1 !== e2) && (edge1.points[0].y < edge2.points[0].y)) {
                    resolveModeGraphEdgeIntersection(edge1.points, (e1.v === n) ? 1 : -1, edge2.points, (e2.v === n) ? 1 : -1);
                }
            }); // edge2
        }); // edge1
    }); // nodes
    
    let i = 0;
    graph.edges().forEach(function(e) {
        const edge = graph.edge(e);
        svg += `<g class="edge" id="${sourceLocationToModeGraphEdgeId(edge.url, edge.lineNumber)}"`;
        if (edge.url) {
            svg += ` onclick="editorGotoFileLine('${edge.url}', ${edge.lineNumber})"`;
        }
        svg += '>';
        // Inherit color from the start node, or use gray for start edge
        edge.color = (! edge.url) ? '#888' : nodeToHTMLColor(graph.node(e.v));
        edge.endColor = nodeToHTMLColor(graph.node(e.w));
        const points = edge.points;
        
        // Define arrow head
        svg += `<defs>
    <marker id="arrowhead${i}" markerWidth="8" markerHeight="8" refX="7" refY="2" orient="auto" position="95%">
      <path d="M 0 0 L 0 4 L 6 2 z" fill="${edge.color}" />
    </marker>
  </defs>`;

        // Browsers have weird svg-filter issues (that affect shadow
        // rendering) with small objects in SVG, even if they have
        // correct bounding boxes.  Compute our own bounds bounds for the curve
        // to detect too-small boxes.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < points.length; ++i) {
            minX = Math.min(minX, points[i].x); minY = Math.min(minY, points[i].y);
            maxX = Math.max(maxX, points[i].x); maxY = Math.max(maxY, points[i].y);
        }
        const tooSmall = Math.min(maxX - minX, maxY - minY) < 8;
        
        // Define bidirectional arrow
        if (edge.bidir) {
            // Set the x1,y1 and x2,y2 based on the path direction
            const first = points[0], last = points[points.length - 1];
            const x1 = (last.x > first.x) ? minX : maxX;
            const y1 = (last.y > first.y) ? minY : maxY;
            const x2 = (last.x > first.x) ? maxX : minX;
            const y2 = (last.y > first.y) ? maxY : minY;

            // gradientUnits="userSpaceOnUse" is needed to support perfectly horizontal lines
            // with zero vertical extent
            svg += `<defs>
    <marker id="endarrowhead${i}" markerWidth="8" markerHeight="8" refX="0" refY="2" orient="auto" position="5%">
      <path d="M 0 2 L 6 0 L 6 4 z" fill="${edge.endColor}" />
    </marker>
    <linearGradient id="gradient${i}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${edge.endColor}"/>
      <stop offset="100%" stop-color="${edge.color}"/>
    </linearGradient>
  </defs>`;
        }

        svg += `<path class="edgeLine" stroke="${edge.bidir ? 'url(#gradient' + i + ')' : edge.color}" marker-end="url(#arrowhead${i})" `;
        if (tooSmall) {
            svg += 'style="filter:none" ';
        }

        if (edge.bidir) {
            svg += `marker-start="url(#endarrowhead${i}" `;
        }

        svg += `d="M ${points[0].x} ${points[0].y} `;

        if (edge.points.length === 2) {
            // Line
            svg += `L ${points[1].x} ${points[1].y}`;
        } else if (edge.points.length === 3) {
            // Quadratic bezier
            svg += `Q ${points[1].x} ${points[1].y}, ${points[2].x} ${points[2].y} `;           
        } else if (edge.points.length === 4) {
            // Never observed to be generated by dagre
            svg += `C ${points[1].x} ${points[1].y}, ${points[2].x} ${points[2].y}, ${points[3].x} ${points[3].y} `;
        } else if (edge.points.length >= 5) {
            // Quadratic bezier with a line in the center. Yse a
            // polyline for that central linear part in case something
            // unexpected happened and there actually are intermediate
            // nodes off the line.
            const N = points.length;
            svg += `Q ${points[1].x} ${points[1].y}, ${points[2].x} ${points[2].y} `;
            for (let i = 3; i < N - 2; ++i) {
                svg += `L ${points[i].x} ${points[i].y} `;
            }
            svg += `Q ${points[N - 2].x} ${points[N - 2].y}, ${points[N - 1].x} ${points[N - 1].y} `;
        }

        svg += '"/>';

        if (edge.label) { svg += `<text class="edgeLabel" x="${edge.x}" y="${edge.y}" fill="${edge.color}">${escapeHTMLEntities(edge.label)}</text>`; }
        svg += '</g>';

        ++i;
    });


    // Nodes on top of everything
    graph.nodes().forEach(function(v) {
        const node = graph.node(v);
        // enlarge the nodes to account for rounded rect
        node.width += 8; node.height += 8;

        // Group elements comprising the visual node
        svg += `<g class="node" id="${modeNameToModeGraphModeId(node.label)}">`;

        if (node.label === '$START') {
            // Simple gray circle for start node, sized to match node height
            svg += `<circle cx="${node.x}" cy="${node.y}" r="${nodeHeight / 2}" fill="#888"/>`;
        } else {
            svg += `<rect x="${node.x - node.width / 2}" y="${node.y - node.height / 2}" width="${node.width}" height="${node.height}" rx="16" ry="16" fill="${nodeToHTMLColor(node)}" onclick="onProjectSelect(undefined, 'mode', gameSource.modes[${gameSource.modes.findIndex(mode => mode.name === node.mode.name)}]);"/>`;

            // Ring for inner border
            svg += `<rect class="border" x="${node.x - node.width / 2 + 2}" y="${node.y - node.height / 2 + 2}" width="${node.width - 4}" height="${node.height - 4}" fill="none" rx="14" ry="14" stroke="none"/>`;
            svg += `<text class="nodeLabel" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}">${node.label}</text>`;
        }
        svg += '</g>';
    });

    svg += '</svg>';
    modeEditor.innerHTML = svg;
}

/* Callback from the runtime when $gameMode is changed.

   - mode: the new mode
   - url: the line of quadplay source that triggered the change
   - line: the line of quadplay source that triggered the change
  */
function $updateIDEModeGraph(mode, url, lineNumber, reason) {
    // Remove highlight from all elements
    const modeGraph = document.querySelector('.modeGraph');
    if (modeGraph) {
        modeGraph.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));
    } else {
        if (useIDE) {console.log('Error: could not find mode graph when using the IDE'); }
        // The mode graph is not open, so do nothing
        return;
    }

    const modeId = modeNameToModeGraphModeId(mode.$name);
    const currentModeNode = document.getElementById(modeId);
    currentModeNode.classList.add('highlight');

    // Highlight either the edge that triggered the mode change or the start edge
    const edgeId = sourceLocationToModeGraphEdgeId(url, lineNumber);
    const lastEdge = document.getElementById(edgeId);
    if (lastEdge) {
        lastEdge.classList.add('highlight');
    } else if (!url) {
        // If no url, try to highlight the start edge
        const startEdge = document.getElementById('mode_graph_edge_start');
        if (startEdge) {
            startEdge.classList.add('highlight');
        }
    } else {
        console.log('ERROR: mode change not found at ' + url + ':' + lineNumber);
    }
}