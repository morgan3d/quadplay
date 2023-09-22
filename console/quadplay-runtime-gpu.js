/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License */
'use strict';

var $Object = Object;
var $console = console;
var $Math = Math;
var $performance = performance;

// Is the GPU loaded as a Worker? Used so that the script could still
// be used as a library in frameworks that do not support Workers.
var $is_web_worker = (self.WorkerGlobalScope && typeof importScripts === 'function');

////////////////////////////////////////////////////////////
//
// Virtual GPU State
//
// These are also declared elsewhere, but when loading as a webworker
// they are needed here so that the GPU runtime can be standalone. The
// 'var' declaration lets them be multiply declared without error.

// Integer dimensions
var $SCREEN_WIDTH, $SCREEN_HEIGHT;

// Writeable framebuffer memory, 16bpp. Uint16Array. Allocated by $resize_framebuffer()
var $screen;

// Aliased version of $screen as Uint32Array; still 16bpp, two pixels
// per element. Allocated by $resize_framebuffer()
var $screen32;

// 32 bpp output double buffer. Sent back to the main thread.
var $updateImageData32;
var $updateImageData;

// Draw list buffer. Array of command objects.
var $graphicsCommandList;

// Readable texture memory. Array of sprites/fonts
var $spritesheetArray;
var $fontArray;

////////////////////////////////////////////////////////////

if ($is_web_worker) {

    importScripts('quadplay-runtime-common.js');

    // onmessage is a specific global name for web workers
    self.onmessage = function (event) {
        // console.log('Event received:', event.data.type);
        
        switch (event.data.type) {
        case 'set_texture':
            // Fix the extended properties, which are not copied by
            // the built-in JavaScript copying/buffer transfer.
            for (let sheet of event.data.spritesheetArray) {
                sheet.$uint16DataFlippedX.width = sheet.$uint16Data.width = sheet.size.x;
                sheet.$uint16DataFlippedX.height = sheet.$uint16Data.height = sheet.size.y;
            }
            for (let font of event.data.fontArray) {
                font.$data.width = font.$size.x;
                font.$data.height = font.$size.y;
            }
            
            $gpu_set_texture(event.data.spritesheetArray, event.data.fontArray);
            break;

        case 'resize_framebuffer':
            $gpu_resize_framebuffer(event.data.SCREEN_WIDTH, event.data.SCREEN_HEIGHT);
            break;

        case 'gpu_execute':
            $updateImageData32 = event.data.updateImageData32;
            $updateImageData = event.data.updateImageData;
            $gpu_execute(...event.data.args);
            break;
        } // switch
    };
} // if webworker


// Called for both the webworker and the main thread
function $gpu_set_texture(spritesheetArray, fontArray) {
    $spritesheetArray   = spritesheetArray;
    $fontArray          = fontArray;
}


function $gpu_resize_framebuffer(w, h) {
    $SCREEN_WIDTH = w;
    $SCREEN_HEIGHT = h;
    $screen = new Uint16Array(w * h);
    $screen32 = new Uint32Array($screen.buffer);
}

function $square(x) { return x * x; }

/** Used by gpu_execute() */
function $zSort(a, b) { return a.z - b.z; }

function $gpu_execute(commandList, backgroundSpritesheetIndex, backgroundColor16) {
    const startTime = performance.now();
    
    // clear the screen
    if (backgroundSpritesheetIndex !== undefined) {
        // Image background
        $screen.set($spritesheetArray[backgroundSpritesheetIndex].$uint16Data);
    } else {
        // Color background (force alpha = 1)
        $screen.fill(backgroundColor16, 0, $screen.length);
    }

    // Sort
    commandList.sort($zSort);
    
    // Eval draw list
    for (let i = 0; i < commandList.length; ++i) {
        const cmd = commandList[i];
        $executeTable[cmd.opcode](cmd);
    }

    {
        // Convert 16-bit to 32-bit
        const dst32 = $updateImageData32;
        const src32 = $screen32;
        const N = src32.length;
        for (let s = 0, d = 0; s < N; ++s) {
            // Read two 16-bit pixels at once
            let src = src32[s];
            
            // Turn into two 32-bit pixels as ABGR -> FFBBGGRR. Only
            // read color channels, as the alpha channel is overwritten with fully
            // opaque.
            let C = ((src & 0x0f00) << 8) | ((src & 0x00f0) << 4) | (src & 0x000f);
            dst32[d] = 0xff000000 | C | (C << 4); ++d; src = src >> 16;
            
            C = ((src & 0x0f00) << 8) | ((src & 0x00f0) << 4) | (src & 0x000f);
            dst32[d] = 0xff000000 | C | (C << 4); ++d;
        }
    }
    
    if ($is_web_worker) {
        // console.log('Transferring updateImageData back to CPU thread');
        postMessage({type: 'submitFrame', gpuTime: performance.now() - startTime, updateImageData: $updateImageData, updateImageData32: $updateImageData32}, [$updateImageData32.buffer]);
        $updateImageData = null;
        $updateImageData32 = null;
    } else {
        $submitFrame($updateImageData, $updateImageData32);
    }
}


/** Color is 16-bit ABGR4. This implementation assumes a little-endian
    processor (which includes all current Intel, AMD, ARM, Raspberry
    Pi processors by default). DataView can be used to make an
    endian-independent version if required. */
function $pset(x, y, color, clipX1, clipY1, clipX2, clipY2) {
    // quadplay pixels have integer centers, so we must round instead of just truncating.
    // Otherwise, for example, -0.7, which is offscreen, would become 0 and be visible.
    //
    // "i >>> 0" converts from signed to unsigned int, which forces negative values to be large
    // and lets us early-out sooner in the tests.
    const i = $Math.round(x) >>> 0;
    const j = $Math.round(y) >>> 0;

    if ((i <= clipX2) && (j <= clipY2) && (i >= clipX1) && (j >= clipY1)) {
        const offset = i + j * $SCREEN_WIDTH;

        // Must be unsigned shift to avoid sign extension
        const a15 = color >>> 12;

        if (a15 === 0xf) {
            // No blending
            $screen[offset] = color;
        } else if (a15 !== 0) {
            // Blend

            // No need to force to unsigned int because the alpha channel of the output is always 0xff
            const a = a15 * (1 / 15);
            let back = $screen[offset] >>> 0;
            let result = 0xF000;
            result |= ((back & 0x0F00) * (1 - a) + (color & 0x0F00) * a + 0.5 * 0x100) & 0x0F00;
            result |= ((back & 0x00F0) * (1 - a) + (color & 0x00F0) * a + 0.5 * 0x010) & 0x00F0;
            result |= ((back & 0x000F) * (1 - a) + (color & 0x000F) * a + 0.5) & 0x000F;
            $screen[offset] = result;
        }
    }
}

/** Assumes x2 >= x1 and that color is ABGR4. Does not assume that x1 and x2 or y are
    on screen. 

    Rounds all coordinates and then draws from x1 to x2 inclusive.
*/
function $hline(x1, y, x2, color, clipX1, clipY1, clipX2, clipY2) {
    x1 = $Math.round(x1) | 0;
    x2 = $Math.round(x2) | 0;
    y  = $Math.round(y)  | 0;

    if ((x2 >= clipX1) && (x1 <= clipX2) && (y >= clipY1) && (y <= clipY2)) {
        // Some part is on screen

        // Don't draw past the edge of the screen
        x1 = $Math.max(x1, clipX1) | 0;
        x2 = $Math.min(x2, clipX2) | 0;
        
        let a15 = (color >>> 12) & 0xf;
        if (a15 === 0xf) {
            // Overwrite
            $screen.fill(color, x1 + (y * $SCREEN_WIDTH), x2 + (y * $SCREEN_WIDTH) + 1);
        } else if (a15 !== 0) {
            // Blend (see comments in $pset)
            const a = a15 * (1 / 15);
            const inva = 1 - a;
            const b = (color & 0xF00) * a + 0.5 * 0x100;
            const g = (color & 0x0F0) * a + 0.5 * 0x010;
            const r = (color & 0x00F) * a + 0.5;

            for (let x = x1, offset = (x1 + y * $SCREEN_WIDTH) | 0; x <= x2; ++x, ++offset) {
                let back = $screen[offset] >>> 0;
                let result = 0xF000 >>> 0;
                result |= ((back & 0x0F00) * inva + b) & 0x0F00;
                result |= ((back & 0x00F0) * inva + g) & 0x00F0;
                result |= ((back & 0x000F) * inva + r) & 0x000F;
                $screen[offset] = result;
            }
        }
    }
}


/** Assumes y2 >= y1 and that color is ABGR4. Does not assume that y1 and y2 or x are
    on screen */
function $vline(x, y1, y2, color, clipX1, clipY1, clipX2, clipY2) {
    x  = $Math.round(x) | 0;
    y1 = $Math.round(y1) | 0;
    y2 = $Math.round(y2) | 0;
    
    if ((y2 >= clipY1) && (y1 <= clipY2) && (x >= clipX1) && (x <= clipX2)) {
        y1 = $Math.max(clipY1, y1);
        y2 = $Math.min(clipY2, y2);

        let a15 = color >>> 12;
        if (a15 === 0xf) {
            for (let y = y1, offset = y1 * $SCREEN_WIDTH + x; y <= y2; ++y, offset += $SCREEN_WIDTH) {
                $screen[offset] = color;
            }
        } else if (a15 !== 0) {
            // Blend (see comments in $pset)
            const a = a15 * (1 / 15);
            const inva = 1 - a;
            const b = (color & 0x0F00) * a + 0.5 * 0x100;
            const g = (color & 0x00F0) * a + 0.5 * 0x010;
            const r = (color & 0x000F) * a + 0.5;
            for (let y = y1, offset = y1 * $SCREEN_WIDTH + x; y <= y2; ++y, offset += $SCREEN_WIDTH) {
                let back = $screen[offset] >>> 0;
                let result = 0xF000;
                result |= ((back & 0x0F00) * inva + b) & 0x0F00;
                result |= ((back & 0x00F0) * inva + g) & 0x00F0;
                result |= ((back & 0x000F) * inva + r) & 0x000F;
                $screen[offset] = result;
            }
        }
    }
}


function $executeCIR(cmd) {
    let outline = cmd.outline, color = cmd.color;
    //    let  x = cmd.x - 0.5, y = cmd.y - 0.5, radius = cmd.radius + 0.5;
    let  x = cmd.x, y = cmd.y, radius = cmd.radius;

    const clipX1 = cmd.clipX1, clipY1 = cmd.clipY1,
          clipX2 = cmd.clipX2, clipY2 = cmd.clipY2;

    // The enclosing box, following the draw_corner_rect() logic, will be
    // Lines from $Math.floor(x - radius + 0.5) to $Math.floor(x + radius - 0.5).
    // Because of the rounding rules in $hline, this is equivalent to:
    //
    //   $hline($Math.floor(x - radius + 0.5), y, $Math.floor(x + radius - 0.5), outline, clipX1, clipY1, clipX2, clipY2)
    // or
    //   $hline(x - radius, y, x + radius - 1, outline, clipX1, clipY1, clipX2, clipY2)

    // Snap to the enclosing box
    const oldX = x, oldY = y;
    x = ($Math.round(oldX - radius) + $Math.round(oldX + radius - 1)) * 0.5
    y = ($Math.round(oldY - radius) + $Math.round(oldY + radius - 1)) * 0.5
    radius = $Math.max(($Math.round(oldX + radius - 1) - $Math.round(oldX - radius)) * 0.5,
                       ($Math.round(oldY + radius - 1) - $Math.round(oldY - radius)) * 0.5);

    // Special case small circles
    if (radius < 0.5) {
        // 1x1
        $pset(x, y, (outline & 0xf000) ? outline : color, clipX1, clipY1, clipX2, clipY2);
        return;
    } else if (radius <= 0.75) {
        // 2x2
        const fillColor = (outline & 0xf000) ? outline : color;
        $hline(x - 0.5, y - 0.5, x + 0.5, fillColor, clipX1, clipY1, clipX2, clipY2);
        $hline(x - 0.5, y + 0.5, x + 0.5, fillColor, clipX1, clipY1, clipX2, clipY2);
        return;
    } else if (radius <= 1.25) {
        // 3x3
        if (outline & 0xf000) {
            $pset(x, y - 1, outline, clipX1, clipY1, clipX2, clipY2);
            $pset(x - 1, y, outline, clipX1, clipY1, clipX2, clipY2);
            $pset(x + 1, y, outline, clipX1, clipY1, clipX2, clipY2);
            $pset(x, y + 1, outline, clipX1, clipY1, clipX2, clipY2);
            $pset(x, y, color, clipX1, clipY1, clipX2, clipY2);
        } else {
            $pset(x, y - 1, color, clipX1, clipY1, clipX2, clipY2);
            $hline(x - 1, y, x + 1, color, clipX1, clipY1, clipX2, clipY2);
            $pset(x, y + 1, color, clipX1, clipY1, clipX2, clipY2);
        }
        return;
    } else if (radius <= 1.75) {
        if (outline & 0xf000) {
            //   **
            //  *  *
            //  *  *
            //   **
            $hline(x - 0.5, y - 1.5, x + 0.5, outline, clipX1, clipY1, clipX2, clipY2);
            $pset(x - 1.5, y - 0.5, outline, clipX1, clipY1, clipX2, clipY2);
            $pset(x + 1.5, y - 0.5, outline, clipX1, clipY1, clipX2, clipY2);
            $pset(x - 1.5, y + 0.5, outline, clipX1, clipY1, clipX2, clipY2);
            $pset(x + 1.5, y + 0.5, outline, clipX1, clipY1, clipX2, clipY2);
            $hline(x - 0.5, y - 0.5, x + 0.5, color, clipX1, clipY1, clipX2, clipY2);
            $hline(x - 0.5, y + 0.5, x + 0.5, color, clipX1, clipY1, clipX2, clipY2);
            $hline(x - 0.5, y + 1.5, x + 0.5, outline, clipX1, clipY1, clipX2, clipY2);
        } else {
            $hline(x - 0.5, y - 1.5, x + 0.5, color, clipX1, clipY1, clipX2, clipY2);
            $hline(x - 1.5, y - 0.5, x + 1.5, color, clipX1, clipY1, clipX2, clipY2);
            $hline(x - 1.5, y + 0.5, x + 1.5, color, clipX1, clipY1, clipX2, clipY2);
            $hline(x - 0.5, y + 1.5, x + 0.5, color, clipX1, clipY1, clipX2, clipY2);
        }
        // 4x4
        return;
    } else if (radius <= 2.5) {
        radius -= 0.4;
    } else if (radius <= 3.5) {
        // Increase rounding of 6x6
        radius -= 0.25;
    }

    const j_unclipped_first = $Math.round(y - radius) | 0;
    const j_min = $Math.max(j_unclipped_first, clipY1 | 0) | 0;

    // The small epsilon keeps the y value from slightly overhanging by one pixel
    // due to roundoff when jittering
    const j_unclipped_last = $Math.round(y + radius - 0.00001) | 0; 
    const j_max = $Math.min(j_unclipped_last, clipY2 | 0) | 0;

    // Intersect this scanline
    //
    // Line Y = j+0.5 intersects Circle (X - x)² + (Y - y)² = r²
    // Substitute:
    //    (x - X)² = r² - (j + 0.5 - y)²
    //    x = -X ± sqrt(r² - (j + 0.5 - y)²)
    //
    // The -0.49999 keeps the top and bottom row consistent with the
    // rest of the circle
    let next_spread = $Math.sqrt($Math.max(radius * radius - $square(Math.abs(j_min - y) - 0.49999), 0.5));
    let next_lo = $Math.round(x - next_spread) >>> 0;
    let next_hi = $Math.round(x + next_spread) >>> 0;
    let prev_lo = 0, prev_hi = 0;
    for (let j = j_min; j <= j_max; ++j) {
        // Inclusive x bounds
        const spread = next_spread;
        let lo = next_lo;
        let hi = next_hi;

        // We need to look one line ahead to connect the bottom half outlines
        next_spread = $Math.sqrt($Math.max(radius * radius - $square(Math.abs(j - y + 1) - 0.49999), 0.5));
        next_lo = $Math.round(x - next_spread) >>> 0;
        next_hi = $Math.round(x + next_spread) >>> 0;

        // Draw the outline first, moving lo and hi as needed to prevent overdraw
        if ((outline & 0xf000) && (outline !== color)) {
            if (j === j_unclipped_first || j === j_unclipped_last) {
                // Connect the first and last rows completely

                // Top
                $hline(lo, j, hi, outline, clipX1, clipY1, clipX2, clipY2);
                
                prev_lo = lo; prev_hi = hi;
                
                // There is no fill in this case because the outline dominates the row
                continue;
            } else if (lo < prev_lo - 1) {
                // On the top half of the circle and need a 2+ pixel horizontal outline.
                // The circle is symmetric, so we only need to check one horizontal side
                // to know that we're in this case.
                $hline(lo, j, prev_lo - 1, outline, clipX1, clipY1, clipX2, clipY2);
                $hline(prev_hi + 1, j, hi, outline, clipX1, clipY1, clipX2, clipY2);
                // Bring in the fill bounds so that they do not overdraw the outline
                // by swapping values.
                {const temp = prev_lo; prev_lo = lo, lo = temp;}
                {const temp = prev_hi; prev_hi = hi, hi = temp;}
            } else if (next_lo > lo + 1) {
                // On the bottom half of the circle and need a 2+ horizontal pixel outline.
                $hline(lo, j, next_lo - 1, outline, clipX1, clipY1, clipX2, clipY2);
                $hline(next_hi + 1, j, hi, outline, clipX1, clipY1, clipX2, clipY2);
                
                prev_lo = next_lo; prev_hi = next_hi;
                // Bring in the fill bounds so that they do not overdraw the outline
                lo = next_lo; hi = next_hi;
            } else {
                $pset(lo, j, outline, clipX1, clipY1, clipX2, clipY2);
                $pset(hi, j, outline, clipX1, clipY1, clipX2, clipY2);
                prev_lo = lo; prev_hi = hi;
                // Bring in the fill bounds so that they do not overdraw the outline
                ++lo; --hi;
            }
        }

        // Fill
        if (color & 0xf000) {
            $hline(lo, j, hi, color, clipX1, clipY1, clipX2, clipY2);
        }

    }
    return;

    /*
    ///////////////////////////////////////////////////////////////////
    // Old midpoint code. That classic algorithm only works when the bounding
    // box is odd. I.e., it always creates a diameter of 2 * floor(r) + 1,
    // so cannot inscribe bounds exactly for arbitrary circles within rectangles.

    if (color & 0xf000) {
        // offset
        let ox = radius - 1, oy = 0;
        
        // step
        let dx = 1, dy = 1;
        let err = dx - radius * 2;

        // Midpoint circle algorithm. Iterate over 1/8 of the circle,
        // reflect to all sides
        while (ox >= oy) {
            // Center
            if (ox !== oy) {
                // Bottom
                $hline(x - ox, y + oy, x + ox, color, clipX1, clipY1, clipX2, clipY2);
                
                // Top
                if (oy > 0) { $hline(x - ox, y - oy, x + ox, color, clipX1, clipY1, clipX2, clipY2); }
            }
                
            let old = oy;
            // -4 gives better shape for small circles
            if (err <= -4) {
                ++oy;
                err += dy;
                dy += 2;
            }

            // ...intentionally no "else" to allow diagonal changes in both x and y position...
            
            if (err > -4) {
                // Caps
                $hline(x - old, y + ox, x + old, color, clipX1, clipY1, clipX2, clipY2);
                $hline(x - old, y - ox, x + old, color, clipX1, clipY1, clipX2, clipY2);
                --ox;
                dx += 2;
                err += dx - radius * 2;
            }
        } // while
    } // if color

    
    if ((outline & 0xf000) && (outline !== color)) {
        // offset
        let ox = radius - 1, oy = 0;

        // step
        let dx = 1, dy = 1;
        let err = dx - radius * 2;

        while (ox >= oy) {
            if (ox !== oy) {
                // Bottom center
                $pset(x - ox, y + oy, outline, clipX1, clipY1, clipX2, clipY2);
                $pset(x + ox, y + oy, outline, clipX1, clipY1, clipX2, clipY2);

                if (oy > 0) {
                    // Top center
                    $pset(x - ox, y - oy, outline, clipX1, clipY1, clipX2, clipY2);
                    $pset(x + ox, y - oy, outline, clipX1, clipY1, clipX2, clipY2);
                }
            }

            // Bottom cap
            $pset(x - oy, y + ox, outline, clipX1, clipY1, clipX2, clipY2);

            // Top cap
            $pset(x - oy, y - ox, outline, clipX1, clipY1, clipX2, clipY2);
            
            if (oy > 0) {
                // Bottom cap
                $pset(x + oy, y + ox, outline, clipX1, clipY1, clipX2, clipY2);
                
                // Top cap
                $pset(x + oy, y - ox, outline, clipX1, clipY1, clipX2, clipY2);
            }

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
    */
}


function $executeREC(cmd) {
    const clipX1 = cmd.clipX1, clipY1 = cmd.clipY1,
          clipX2 = cmd.clipX2, clipY2 = cmd.clipY2;

    const data = cmd.data;

    for (let i = 0; i < data.length; ++i) {
        const rect = data[i];
        const outline = rect.outline, fill = rect.fill;
        let x1 = rect.x1, x2 = rect.x2, y1 = rect.y1, y2 = rect.y2;

        if ((outline !== fill) && (outline > 0xFFF)) {
            $hline(x1, y1, x2, outline, clipX1, clipY1, clipX2, clipY2);
            $hline(x1, y2, x2, outline, clipX1, clipY1, clipX2, clipY2);
            $vline(x1, y1 + 1, y2 - 1, outline, clipX1, clipY1, clipX2, clipY2);
            $vline(x2, y1 + 1, y2 - 1, outline, clipX1, clipY1, clipX2, clipY2);
            x1 += 1; y1 += 1; x2 -= 1; y2 -= 1;
        }
        
        if (fill & 0xf000) {
            
            // Snap to integer and set_clip to screen. We don't need to
            // round because we know that the rect is visible.
            x1 = $Math.max((x1 + 0.5) | 0, clipX1);
            x2 = $Math.min((x2 + 0.5) | 0, clipX2);
            y1 = $Math.max((y1 + 0.5) | 0, clipY1);
            y2 = $Math.min((y2 + 0.5) | 0, clipY2);

            // Blend spans
            for (let y = y1, i = y1 * $SCREEN_WIDTH; y <= y2; ++y, i += $SCREEN_WIDTH) {
                $hline(x1, y, x2, fill, clipX1, clipY1, clipX2, clipY2);
            }
        }
    }
}


function $executeLIN(cmd) {
    $line(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.color, cmd.clipX1, cmd.clipY1, cmd.clipX2, cmd.clipY2, cmd.open1, cmd.open2);
}


function $line(x1, y1, x2, y2, color, clipX1, clipY1, clipX2, clipY2, open1, open2) {
    if (y1 === y2) {
        // Horizontal perf optimization/avoid divide by zero
        const dx = $Math.sign(x2 - x1)
        if (open1) { x1 += dx; }
        if (open2) { x2 -= dx; }
        $hline($Math.min(x1, x2), y1, $Math.max(x1, x2), color, clipX1, clipY1, clipX2, clipY2);
    } else if (x1 === x2) {
        // Vertical perf optimization
        const dy = $Math.sign(y2 - y1)
        if (open1) { y1 += dy; }
        if (open2) { y2 -= dy; }
        $vline(x1, $Math.min(y1, y2), $Math.max(y1, y2), color, clipX1, clipY1, clipX2, clipY2);
    } else {
        // General case via DDA

        // Slope:
        const dx = x2 - x1, dy = y2 - y1;
        const moreHorizontal = Math.abs(dx) > Math.abs(dy);

        if ((moreHorizontal && (x2 < x1)) ||
            (! moreHorizontal && (y2 < y1))) {
            // Swap endpoints to go in increasing direction on the dominant axis.
            // Slope is unchanged because both deltas become negated.
            let temp;
            temp = y1; y1 = y2; y2 = temp;
            temp = x1; x1 = x2; x2 = temp;
            temp = open1; open1 = open2; open2 = temp;
        }

        if (moreHorizontal) {
            // Crop horizontally:
            const m = dy / dx;

            if (open1) { ++x1; y1 += m; }            
            if (open2) { --x2; /* y2 is unused */ } 

            // Adjust for x1 being clipped
            const step = $Math.max(clipX1, x1) - x1;
            x1 += step; y1 += m * step;

            // Adjust for x2 being clipped (y2 is unused, so ignore it)
            x2 = $Math.min(x2, clipX2);

            x1 |= 0; x2 |= 0;

            if ((color & 0xf000) === 0xf000) {
                // No blending
                for (let x = x1, y = y1; x <= x2; ++x, y += m) {
                    const j = $Math.round(y) >>> 0;
                    if ((j <= clipY2) && (j >= clipY1)) {
                        $screen[x + j * $SCREEN_WIDTH | 0] = color;
                    }
                }
            } else {
                for (let x = x1, y = y1; x <= x2; ++x, y += m) {
                    $pset(x, y, color, clipX1, clipY1, clipX2, clipY2);
                } // for x
            }
        } else { // Vertical
            // Compute the inverted slope
            const m = dx / dy;

            if (open1) { ++y1; x1 += m; } 
            if (open2) { --y2; x2 -= m; } 
            
            // Crop vertically:
            const step = $Math.max(clipY1, y1) - y1;
            x1 += step * m; y1 += step;
            y2 = $Math.min(y2, clipY2);
            y1 |= 0; y2 |= 0;

            if ((color & 0xf000) === 0xf000) {
                // No blending
                for (let y = y1, base = (y1 * $SCREEN_WIDTH) | 0, x = x1; y <= y2; ++y, base += $SCREEN_WIDTH | 0, x += m) {
                    const i = $Math.round(x) >>> 0;
                    if ((i <= clipX2) && (i >= clipX1)) {
                        $screen[base + i] = color;
                    }
                } // for y
            } else {
                for (let y = y1, x = x1; y <= y2; ++y, x += m) {
                    $pset(x, y, color, clipX1, clipY1, clipX2, clipY2);
                } // for y
            }
            
        } // if more horizontal
    } // if diagonal
}


/* Run-length encoded horizontal or vertical spans of points
   that have already been clipped and flattened to 16-bit */
function $executeSPN(cmd) {
    // Uint16Array formatted in blocks, where the USED length is
    // separately encoded because the array has to be allocated
    // before it is known how much will be used.
    //
    // For each block, the header element specifies:
    //
    // - header & 0x1 is 1 if the entire block has alpha = 0xf and can be memcpy'd
    // - header & 0x2 is 1 if the block has alpha = 0x0 (in which case, there is
    //              no actual data in the block)
    // - header >> 2 is the length of the span. 
    //
    // Blocks with both low bits == 0 *may* have some alpha = 0x0 and
    // some alpha = 0xf pixels in them.
    const data = cmd.data;
    const N = cmd.data_length;

    const dst_step = (cmd.dx + $SCREEN_WIDTH * cmd.dy) | 0;
    let dst_index = (cmd.x + $SCREEN_WIDTH * cmd.y) | 0;
    let src_index = 0;
    
    while (src_index < N) {
        const header = data[src_index++];
        const length = header >> 2;
        
        const skip = header & 0x2;
        if (skip) {
            dst_index += length * dst_step;
        } else {
            const opaque = header & 0x1;
            if (opaque) {
                if (dst_step === 1) {
                    // Horizontal span
                    // Memcpy from data[src_index] to $screen[dst_index]
                    $screen.set(data.subarray(src_index, src_index + length), dst_index);
                    src_index += length;
                    dst_index += length * dst_step;
                } else {
                    // Vertical span
                    for (let i = 0; i < length; ++i, ++src_index, dst_index += dst_step) {
                        $screen[dst_index] = data[src_index];
                    }
                }
            } else {
                // Maybe blend
                for (let i = 0; i < length; ++i, dst_index += dst_step) {
                    const color = data[src_index++];
                    
                    // Must be unsigned shift to avoid sign extension
                    const a15 = color >>> 12;
                    
                    if (a15 === 0xf) {
                        // No blending
                        $screen[dst_index] = color;
                    } else {
                        // Blend
                        
                        // No need to force to unsigned int because the alpha channel of the output is always 0xff
                        const a = a15 * (1 / 15);
                        const back = $screen[dst_index] >>> 0;
                        let result = 0xF000;
                        result |= ((back & 0x0F00) * (1 - a) + (color & 0x0F00) * a + 0.5 * 0x0100) & 0x0F00;
                        result |= ((back & 0x00F0) * (1 - a) + (color & 0x00F0) * a + 0.5 * 0x0010) & 0x00F0;
                        result |= ((back & 0x000F) * (1 - a) + (color & 0x000F) * a + 0.5) & 0x000F;
                        $screen[dst_index] = result;
                    }
                } // loop over pixels
            } // if opaque block
        } // if skip
        
    } // loop over blocks
}


function $executePIX(cmd) {
    // Series of points that have already been clipped
    // and converted to integers.
    
    const data = cmd.data;
    const N = (cmd.data_length !== undefined) ? cmd.data_length : data.length;

    // There's surprisingly no performance advantage for tracking
    // whether blending is needed anywhere in the array during
    // submission and extracting that case into a no-blend tiny loop
    // below.
    for (let p = 0; p < N; p += 2) {
        const color = data[p + 1];
        
        // Must be unsigned shift to avoid sign extension
        const a15 = color >>> 12;
        
        if (a15 === 0xf) {
            // No blending
            $screen[data[p]] = color;
        } else {
            // Blend
            
            // No need to force to unsigned int because the alpha channel of the output is always 0xff
            const a = a15 * (1 / 15);
            const offset = data[p];
            let back = $screen[offset];
            let result = 0xF000;
            result |= ((back & 0x0F00) * (1 - a) + (color & 0x0F00) * a + 0.5 * 0x0100) & 0x0F00;
            result |= ((back & 0x00F0) * (1 - a) + (color & 0x00F0) * a + 0.5 * 0x0010) & 0x00F0;
            result |= ((back & 0x000F) * (1 - a) + (color & 0x000F) * a + 0.5) & 0x000F;
            $screen[offset] = result;
        }
    }
}


function $executeSPR(metaCmd) {
    // Note that these are always integers, which we consider
    // pixel centers.
    const clipX1 = metaCmd.clipX1, clipY1 = metaCmd.clipY1,
          clipX2 = metaCmd.clipX2, clipY2 = metaCmd.clipY2;

    // For each sprite in the array
    const data = metaCmd.data;
    for (let i = 0; i < data.length; ++i) {
        const cmd = data[i];

        let opacity = cmd.opacity;
        const override_color = cmd.override_color;
        
        // Compute the net transformation matrix

        // Source bounds, inclusive
        const srcX1 = cmd.cornerX, srcX2 = cmd.cornerX + cmd.sizeX - 1,
              srcY1 = cmd.cornerY, srcY2 = cmd.cornerY + cmd.sizeY - 1;
        
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
              SX = srcX1 + cmd.sizeX * 0.5, SY = srcY1 + cmd.sizeY * 0.5;

        // Snap nearly 0 or 1 values to perfect to avoid
        // falling into awkward roundoff cases
        const angle = ($Math.abs(cmd.angle) < 1e-8) ? 0 : cmd.angle;
        const cos = $Math.cos(angle), sin = $Math.sin(angle);
        const fx = $Math.abs(cmd.scaleX - 1) < 1e-8 ? 1 : cmd.scaleX,
              fy = $Math.abs(cmd.scaleY - 1) < 1e-8 ? 1 : cmd.scaleY;

        const A = cos/fx, B = -sin/fx, C =  sin/fy, D = cos/fy;
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
                const srcX = srcX1 + i * cmd.sizeX,
                      srcY = srcY1 + j * cmd.sizeY;

                // Transform from texture space to pixel space
                let tmp = E * (srcX - SX) + G * (srcY - SY) + DX;
                dstX1 = $Math.min(tmp, dstX1); dstX2 = $Math.max(tmp, dstX2);
                
                tmp     = F * (srcX - SX) + H * (srcY - SY) + DY;
                dstY1 = $Math.min(tmp, dstY1); dstY2 = $Math.max(tmp, dstY2);
            }
        }

        // Round the bounding box using the draw_rect rules for inclusive integer
        // bounds with open top and left edges at pixel center samples.
        dstX1 = $Math.round(dstX1); dstY1 = $Math.round(dstY1);
        dstX2 = $Math.floor(dstX2 - 0.5); dstY2 = $Math.floor(dstY2 - 0.5);

        // Restrict to the clipping region
        dstX1 = $Math.max(dstX1, clipX1); dstY1 = $Math.max(dstY1, clipY1);
        dstX2 = $Math.min(dstX2, clipX2); dstY2 = $Math.min(dstY2, clipY2);

        // Iterate over *output* pixel centers in this region. Because the
        // transformed texel centers won't usually land exactly on pixel
        // centers, we have to be conservative with the bounds here.
        //
        // Don't snap the bounds to integers...we want to hit points that
        // correspond to texel centers in the case where there is no
        // rotation or scale (we'll end up rounding the actual destination
        // pixels later and stepping in integer increments anyway).

        if (cmd.spritesheetIndex >= $spritesheetArray.length) {
            $console.log('GPU spritesheetIndex out of bounds at:', cmd);
        }
        $console.assert(cmd.spritesheetIndex !== undefined &&
                        cmd.spritesheetIndex >= 0 &&
                        cmd.spritesheetIndex < $spritesheetArray.length,
                        'spritesheetIndex out of bounds:', cmd.spritesheetIndex);
        // May be reassigned below when using flipped X values
        let srcData = $spritesheetArray[cmd.spritesheetIndex].$uint16Data;
        console.assert(srcData.width !== undefined);

        const srcDataWidth = srcData.width >>> 0;
        
        if (($Math.abs($Math.abs(A) - 1) < 1e-10) && ($Math.abs(B) < 1e-10) &&
            ($Math.abs(C) < 1e-10) && ($Math.abs($Math.abs(D) - 1) < 1e-10) &&
            (! override_color)) {

            // console.log('simple', srcData[0].toString(16), srcData[1].toString(16), srcData[2].toString(16));

            // Simple case; x and y-axis uniform scale, no rotation, and no alpha
            // test. Use a memcpy.  The x and y-axes may be inverted, and there
            // can be xy translation applied. This branch is primarily
            // here to accelerate map rendering.

            // All of the "| 0" are to force values to integers, which massively
            // improves performance on Safari (5x in some cases)

            const width = (dstX2 - dstX1 + 1) | 0;
            if (width >= 1) {
                const srcY = ((dstY1 + 0.4999 - DY) * $Math.sign(D) + SY) | 0;
                let srcOffset = ((((dstX1 + 0.4999 - DX) + SX) | 0) + srcY * srcDataWidth) | 0;
                let dstOffset = (dstX1 + dstY1 * $SCREEN_WIDTH) | 0;
                const srcStep = (srcDataWidth * $Math.sign(D)) | 0;

                if (A < 0) {
                    // Use the flipped version
                    srcOffset = (srcOffset + srcDataWidth - 2 * SX) | 0;
                    srcData = $spritesheetArray[cmd.spritesheetIndex].$uint16DataFlippedX;
                }
                if ((! cmd.hasAlpha) && ($Math.abs(opacity - 1) < 1e-10)) {
                    // Memcpy case
                    for (let dstY = dstY1; dstY <= dstY2; ++dstY) {
                        //console.log(srcData.subarray(srcOffset, srcOffset + width));
                        // This TypedArray.set call saves about 3.5
                        // ms/frame compared to an explicit horizontal
                        // loop for map rendering on Firefox. Chrome
                        // and Safari are fast even for the general
                        // case. So, this isn't necessary on those
                        // browsers, but it doesn't hurt.
                        
                        // console.assert(dstOffset + width <= $screen.length, `dstX1=${dstX1}, dstX2 = ${dstX2}, $screen.length = ${$screen.length}, width = ${width}, dstOffset = ${dstOffset}, dstOffset % $SCREEN_WIDTH = ${dstOffset % $SCREEN_WIDTH}, dstY = ${dstY}, dstY2 = ${dstY2}`);
                        // console.assert(srcOffset + width <= srcData.length);
                        $screen.set(srcData.subarray(srcOffset, srcOffset + width), dstOffset);
                        
                        // Putting this increment at the bottom slightly
                        // improves Safari performance
                        dstOffset = (dstOffset + $SCREEN_WIDTH) | 0;
                        srcOffset = (srcOffset + srcStep) | 0;
                    } // dstY
                } else {
                    // Blending or alpha test case
                    for (let dstY = dstY1; dstY <= dstY2; ++dstY) {
                        for (let i = 0; i < width; ++i) {
                            // Forcing the read value back to an integer improves
                            // performance slightly on Safari (5%)
                            let color = srcData[srcOffset + i] >>> 0;
                            let a15 = color >>> 12;

                            // Test alpha *first* in this case, because quite often we'll be in a sprite
                            // with a lot of alpha === 0 pixels and not need to go further.
                            if (a15 !== 0) {
                                // Blending
                                if (opacity < 1) {
                                    // Make more transparent
                                    a15 = (a15 * opacity + 0.5) >>> 0;
                                }

                                if (a15 === 0xf) {
                                    // 100% alpha, no blend needed
                                    $screen[dstOffset + i] = (color | 0xF000) >>> 0;
                                } else if (a15 !== 0) {
                                    // Fractional alpha
                                
                                    // No need to force to unsigned int because the alpha channel of
                                    // the output is always 0xff
                                    const a = a15 * (1 / 15);
                                    const back = $screen[dstOffset + i] >>> 0;
                                    
                                    let result = 0xF000 >>> 0;
                                    result |= ((back & 0x0F00) * (1 - a) + (color & 0x0F00) * a + 0.5 * 0x100) & 0x0F00;
                                    result |= ((back & 0x00F0) * (1 - a) + (color & 0x00F0) * a + 0.5 * 0x010) & 0x00F0;
                                    result |= ((back & 0x000F) * (1 - a) + (color & 0x000F) * a + 0.5) & 0x000F;

                                    $screen[dstOffset + i] = result;
                                }
                            } // alpha > 0
                        } // column
                        
                        // Putting this increment at the bottom slightly
                        // improves Safari performance. Casting to integer
                        // MASSIVELY improves Safari performance.
                        dstOffset = (dstOffset + $SCREEN_WIDTH) | 0;
                        srcOffset = (srcOffset + srcStep) | 0;
                    } // row
                } // needs alpha
            } // width >= 1
        } else if (! override_color && (! cmd.hasAlpha) && ($Math.abs(opacity - 1) < 1e-10)) {
            // No blending case with rotation and scale
            dstY1 |= 0; dstY2 |= 0;
            for (let dstY = dstY1; dstY <= dstY2; ++dstY) {
                // Offset everything by 0.5 to transform the pixel
                // center. Needs to be *slightly* less in order to round
                // the correct way.
                const xterms = (dstY + 0.4999 - DY) * B + SX + (0.4999 - DX) * A;
                const yterms = (dstY + 0.4999 - DY) * D + SY + (0.4999 - DX) * C;
                
                let dstOffset = dstX1 + dstY * $SCREEN_WIDTH;
                
                for (let dstX = dstX1; dstX <= dstX2; ++dstX, ++dstOffset) {
                    const srcX = (dstX * A + xterms) | 0;
                    const srcY = (dstX * C + yterms) | 0;

                    if ((srcX >= srcX1) && (srcX <= srcX2) && (srcY >= srcY1) && (srcY <= srcY2)) {
                        // Inside the source sprite
                        $screen[dstOffset] = srcData[srcX + srcY * srcDataWidth];
                    } // clamp to source bounds
                } // dstX
            } // dstY
            
        } else {
            // General case.
            // Extract the common terms of blending into the override color
            const override = override_color;
            const override_a = 1 - (override >>> 12) * (1 / 15);
            const override_mode = (override_color && cmd.multiply) ? 3 : ((override_a === 1) ? 0 : (override_a === 0) ? 2 : 1);
            const override_b = (override & 0x0F00) * (1 - override_a) + 0.5;
            const override_g = (override & 0x00F0) * (1 - override_a) + 0.5;
            const override_r = (override & 0x000F) * (1 - override_a) + 0.5;

            // Float versions
            const override_fb = ((override >> 8) & 0xf) * (1 / 15);
            const override_fg = ((override >> 4) & 0xf) * (1 / 15);
            const override_fr = (override & 0xf) * (1 / 15);
            
            dstY1 |= 0; dstY2 |= 0;
            for (let dstY = dstY1; dstY <= dstY2; ++dstY) {
                // Offset everything by 0.5 to transform the pixel
                // center. Needs to be *slightly* less in order to round
                // the correct way.
                const xterms = (dstY + 0.4999 - DY) * B + SX + (0.4999 - DX) * A;
                const yterms = (dstY + 0.4999 - DY) * D + SY + (0.4999 - DX) * C;
                
                let dstOffset = (dstX1 + dstY * $SCREEN_WIDTH) | 0;
                
                for (let dstX = dstX1; dstX <= dstX2; ++dstX, ++dstOffset) {
                    const srcX = (dstX * A + xterms) | 0;
                    const srcY = (dstX * C + yterms) | 0;

                    if ((srcX >= srcX1) && (srcX <= srcX2) && (srcY >= srcY1) && (srcY <= srcY2)) {
                        // Inside the source sprite

                        // May be overriden below.
                        let color = srcData[srcX + srcY * srcDataWidth];
                        if (opacity < 1) {
                            // Make more transparent
                            
                            // 4 high bits
                            const alpha4 = ((color >>> 12) * opacity + 0.5) | 0;
                            color = ((alpha4 << 12) | (color & 0xFFF)) >>> 0;
                        }
                        
                        // the following is an inlining of: $pset(dstX, dstY, color, clipX1, clipY1, clipX2, clipY2);
                        
                        // Must be unsigned shift to avoid sign extension
                        const a15 = color >>> 12;
                        if (a15 === 0) {
                            // 0% alpha
                        } else {

                            if (override_mode === 0) {
                                // Common case, do nothing
                            } else if (override_mode === 1) {
                                // Blend
                                const src = color;
                                color &= 0xF000;
                                color |= (override_b + (src & 0x0F00) * override_a) & 0x0F00;
                                color |= (override_g + (src & 0x00F0) * override_a) & 0x00F0;
                                color |= (override_r + (src & 0x000F) * override_a) & 0x000F;
                            } else if (override_mode === 2) {
                                // Completely overwrite
                                color = (color & 0xF000) | (override & 0xFFF);
                            } else { // mode 3
                                // Multiply
                                const src = color;
                                color &= 0xF000;
                                color |= (override_fb * (src & 0x0F00) + (0.5 * 0x100)) & 0x0F00;
                                color |= (override_fg * (src & 0x00F0) + (0.5 * 0x010)) & 0x00F0;
                                color |= (override_fr * (src & 0x000F) +  0.5)          & 0x000F;
                            }

                            if (a15 === 0xf) {
                                // 100% alpha
                                $screen[dstOffset] = color;
                            } else if (a15 != 0) {
                                // Fractional alpha
                                
                                // No need to force to unsigned int because the alpha channel of the output is always 0xff
                                const a = a15 * (1 / 15);
                                const back = $screen[dstOffset];
                                let result = 0xF000;
                                
                                result |= ((back & 0x0F00) * (1 - a) + (color & 0x0F00) * a + 0.5 * 0x100) & 0x0F00;
                                result |= ((back & 0x00F0) * (1 - a) + (color & 0x00F0) * a + 0.5 * 0x010) & 0x00F0;
                                result |= ((back & 0x000F) * (1 - a) + (color & 0x000F) * a + 0.5) & 0x000F;
                                
                                $screen[dstOffset] = result;
                            }
                        }
                    } // clamp to source bounds
                } // i
            } // j
        } // if simple case
    } // for each sprite
}


function $executeTXT(cmd) {
    const height = cmd.height, width = cmd.width, color = cmd.color,
          str = cmd.str
    let   outline = cmd.outline, shadow = cmd.shadow;
    const clipX1 = cmd.clipX1, clipY1 = cmd.clipY1,
          clipX2 = cmd.clipX2, clipY2 = cmd.clipY2;
    const font = $fontArray[cmd.fontIndex];
    const data = font.$data.data;
    const fontWidth = font.$data.width;

    let x = cmd.x, y = cmd.y;

    if ((font.spacing.x === 0) && (outline & 0xF000) && (color & 0xF000)) {
        // Script font with outline and color. Draw in two passes so that
        // the connectors are not broken by outlines.
        
        // Disable color and re-issue the command to draw shadow and outline
        // before drawing the main text.
        cmd.color = 0;
        $executeTXT(cmd);
        cmd.color = color;

        // Pass through, disabling outline and shadow that were
        // already processed.
        outline = shadow = 0;
    }
    
    for (let c = 0; c < str.length; ++c) {
        // Remap the character to those in the font sheet
        const chr = str[c];
        const bounds = font.$bounds[chr];

        x += bounds.pre;
        if (chr !== ' ') {
            const tileY = $Math.floor(bounds.y1 / font.$charHeight) * font.$charHeight;
            const charWidth  = bounds.x2 - bounds.x1 + 1;
            const charHeight = bounds.y2 - bounds.y1 + 1;

            // Shift the destination down by the offset of this character relative to the tile
            for (let j = 0, dstY = y + bounds.y1 - tileY + bounds.yOffset; j < charHeight; ++j, ++dstY) {
                // On screen in Y?
                if (((dstY >>> 0) <= clipY2) && (dstY >= clipY1)) {
                    for (let i = 0, dstX = x, dstIndex = x + (dstY * $SCREEN_WIDTH), srcIndex = bounds.x1 + (bounds.y1 + j) * fontWidth;
                         i < charWidth;
                         ++i, ++dstX, ++dstIndex, ++srcIndex) {
                        
                        const bits = data[srcIndex];

                        // Most pixels in fonts are empty, so explicitly test if ANY bit
                        // is set before looking deeper
                        if (bits) {
                            let v = 0;
                            if (bits & 0x1) {                 // 0001 color = color
                                v = color;
                            } else if (outline & 0xf000) {
                                // Outline is on
                                if (bits & 0x8) {             // 1000 outline w/ shadow = shadow
                                    // Shadow if using outline
                                    v = shadow;
                                } else if (bits & 0x2) {      // 0010 outline. May also match 0100 and be ignored
                                    v = outline;
                                }
                            } else if (bits & 0x4) {          // 0100 shadow w/o outline
                                // Shadow
                                v = shadow;
                            }

                            // Could inline $pset code for performance and insert dstIndex. There
                            // is not any apparent performance difference on Chrome, however
                            if (v) { $pset(dstX, dstY, v, clipX1, clipY1, clipX2, clipY2); }
                        }
                    } // for i
                } // on screen y
            } // for j
            
        } // character in font

        x += (bounds.x2 - bounds.x1 + 1) + $postGlyphSpace(chr + (str[c] || ''), font) - font.$borderSize * 2 + bounds.post;
        
    } // for each character
}


// Convex polygon rendering
function $executePLY(cmd) {
    const clipX1 = cmd.clipX1, clipY1 = cmd.clipY1,
          clipX2 = cmd.clipX2, clipY2 = cmd.clipY2;
    const points = cmd.points;
    const numPoints = points.length >> 1;
    const color = cmd.color, outline = cmd.outline;
    
    // Fill
    if (color & 0xf000) {
        const shift = ((outline & 0xf000) && (outline !== color)) ? 0.5 : 0;
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

        // Add all edges
        for (let p = 0; p < points.length - 3; p += 2) {
            addEdge(points[p], points[p + 1], points[p + 2], points[p + 3]);
        }
        {
            // Wraparound to close the polygon
            const p = points.length - 2;
            addEdge(points[p], points[p + 1], points[0], points[1]);
        }

        // Intentionally left as a float to avoid int->float
        // conversion within the inner loop
        y0 = $Math.max(clipY1, $Math.floor(y0));
        y1 = $Math.min(clipY2, $Math.floor(y1));
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
                    x0 = $Math.min(x0, x);
                    x1 = $Math.max(x, x1);
                }
            }

            // If there was a nonzero line length, draw it
            if (x0 + shift <= x1 - shift) {
                $hline(x0 + shift, y, x1 - shift, color, clipX1, clipY1, clipX2, clipY2);
            }
        }
    }

    if ((outline & 0xf000) && (outline !== color)) {
        for (let p = 0; p < points.length - 3; p += 2) {
            $line(points[p], points[p + 1], points[p + 2], points[p + 3], outline, clipX1, clipY1, clipX2, clipY2, false, true);
        }
        {
            // Wraparound to close the polygon
            const p = points.length - 2;
            $line(points[p], points[p + 1], points[0], points[1], outline, clipX1, clipY1, clipX2, clipY2, false, true);
        }
    }
}


var $executeTable = Object.freeze({
    REC : $executeREC,
    CIR : $executeCIR,
    SPR : $executeSPR,
    PIX : $executePIX,
    TXT : $executeTXT,
    LIN : $executeLIN,
    PLY : $executePLY,
    SPN : $executeSPN
});
