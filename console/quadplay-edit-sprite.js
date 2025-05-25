"use strict";

let spriteEditorAsset = null;
let spriteEditorAssetName = null;

function onSpriteEditorViewChange() {
    const spriteEditorCanvas = document.getElementById('spriteEditorCanvas');
    const context = spriteEditorCanvas.getContext("2d");

    if (document.getElementById('spriteEditorViewPNG').checked) {
        spriteEditorCanvasShowImage(spriteEditorAsset.$url);
    } else {
        console.dir(spriteEditorAsset);
        // Clear the background
        const size = spriteEditorAsset.size || spriteEditorAsset.$size;
        spriteEditorCanvas.style.backgroundImage = 'none';
        spriteEditorCanvas.style.width = `${size.x}px`;
        spriteEditorCanvas.width = size.x;
        spriteEditorCanvas.style.height = `${size.y}px`;
        spriteEditorCanvas.height = size.y;
        context.reset();

        // Draw to the canvas
        let imageData;
        if (spriteEditorAsset.$type === 'spritesheet') {
            imageData = spriteSheetToImageData(spriteEditorAsset);
        } else {
            console.dir(spriteEditorAsset);
            console.assert(spriteEditorAsset.$type === 'font');
            imageData = fontToImageData(spriteEditorAsset);
        }
        context.putImageData(imageData, 0, 0);
    }
}


function spriteSheetToImageData(spriteEditorAsset) {    
    const src = spriteEditorAsset.$uint16Data;
    const dst = new ImageData(spriteEditorAsset.size.x, spriteEditorAsset.size.y);
    // Create the destination pixel array
    const dstPixels = dst.data;
    
    // Process each pixel
    for (let i = 0; i < src.length; ++i) {
        const pixel = src[i];
        
        // Extract 4-bit RGBA channels from 16-bit value
        // Multiply by 17 to convert 4-bit to 8-bit (0-15 -> 0-255). This is 
        // the same as doubling the hex digit
        const a = ((pixel >> 12) & 0xF) * 17; 
        const b = ((pixel >> 8) & 0xF) * 17;
        const g = ((pixel >> 4) & 0xF) * 17;
        const r = (pixel & 0xF) * 17;

        // Write to destination array (4 bytes per pixel)
        const j = i * 4;
        dstPixels[j] = r;
        dstPixels[j + 1] = g; 
        dstPixels[j + 2] = b;
        dstPixels[j + 3] = a;
    }

    return dst;
}



function fontToImageData(spriteEditorAsset) {    
    const src = spriteEditorAsset.$data.data;
    const dst = new ImageData(spriteEditorAsset.$size.x, spriteEditorAsset.$size.y);
    // Create the destination pixel array
    const dstPixels = dst.data;
    
    // Process each pixel
    for (let i = 0; i < src.length; ++i) {
        const pixel = src[i];

        const a = pixel ? 0xFF : 0x00; 
        let r = 0, g = 0, b = 0;
        if (pixel & 0x1) {
            // 0b0001 drawn
            r = g = b = 0xFF; 
        } else if (pixel & 0x2) {
            // 0b0010 outline always
            r = 0x00; g = 0x00; b = 0x00;
        } else if (pixel & 0x4) {
            // 0b0100 outline only when shadow is off
            r = 0x00; g = 0xFF; b = 0x00;
        } else if (pixel & 0x8) {
            // 0b1000 outline only when shadow is on, otherwise shadow
            r = 0x00; g = 0x88; b = 0xFF;
        }

        // Write to destination array (4 bytes per pixel)
        const j = i * 4;
        dstPixels[j] = r;
        dstPixels[j + 1] = g; 
        dstPixels[j + 2] = b;
        dstPixels[j + 3] = a;
    }

    return dst;
}


function spriteEditorCanvasShowImage(url) {
    const spriteEditorCanvas = document.getElementById('spriteEditorCanvas');

    // Support both fonts.$size and spritesheet.size
    const size = spriteEditorAsset.size || spriteEditorAsset.$size;
    spriteEditorCanvas.style.width = `${size.x}px`;
    spriteEditorCanvas.style.height = `${size.y}px`;
    // Force a reload with the ?
    spriteEditorCanvas.style.backgroundImage = `url("${url}?reload${new Date() / 1000}")`;

    spriteEditorCanvas.getContext("2d").reset();
}


function onSpriteEditorCanvasMouseMove(e) {
    if (spriteEditorAsset.size === undefined) {
        console.warn('spriteEditorAsset.size is undefined');
        return;
    }
    const canvasBounds = spriteEditorCanvas.getBoundingClientRect();
    const scale = parseFloat(spriteEditorCanvas.style.scale);
    
    const mouseX = e.clientX - canvasBounds.left;
    const mouseY = e.clientY - canvasBounds.top;

    const scaledSpriteWidth = spriteEditorAsset.sprite_size.x * scale;
    const scaledSpriteHeight = spriteEditorAsset.sprite_size.y * scale;

    const scaledSpriteStrideWidth = (spriteEditorAsset.sprite_size.x + spriteEditorAsset.$gutter) * scale;
    const scaledSpriteStrideHeight = (spriteEditorAsset.sprite_size.y + spriteEditorAsset.$gutter) * scale;

    spriteEditorPivot.style.fontSize = Math.round(clamp(Math.min(scaledSpriteWidth, scaledSpriteHeight) * 0.18, 5, 25)) + 'px';

    // Offset for the sprite region within the PNG
    const scaledCornerX = spriteEditorAsset.$sourceRegion.corner.x * scale;
    const scaledCornerY = spriteEditorAsset.$sourceRegion.corner.y * scale;

    // Integer spritesheet index (before transpose)
    let X = Math.floor((mouseX - scaledCornerX) / scaledSpriteStrideWidth);
    let Y = Math.floor((mouseY - scaledCornerY) / scaledSpriteStrideHeight);

    let spritePixelX = Math.floor(mouseX / scale - spriteEditorAsset.$sourceRegion.corner.x) % spriteEditorAsset.sprite_size.x;
    let spritePixelY = Math.floor(mouseY / scale - spriteEditorAsset.$sourceRegion.corner.y) % spriteEditorAsset.sprite_size.y;

    spriteEditorHighlight.style.left   = Math.floor(X * scaledSpriteStrideWidth + scaledCornerX) + 'px';
    spriteEditorHighlight.style.top    = Math.floor(Y * scaledSpriteStrideHeight + scaledCornerY) + 'px';
    spriteEditorHighlight.style.width  = Math.floor(scaledSpriteWidth) + 'px';
    spriteEditorHighlight.style.height = Math.floor(scaledSpriteHeight) + 'px';

    let U = X, V = Y;
    if (spriteEditorAsset.$json.transpose) {
        U = Y; V = X;
        const temp = spritePixelX; spritePixelX = spritePixelY; spritePixelY = temp;
    }

    const sprite = spriteEditorAsset[U] && spriteEditorAsset[U][V];

    if (sprite) {
        const pivot = sprite.pivot || {x: 0, y: 0};
        spriteEditorPivot.style.visibility = 'visible';
        spriteEditorPivot.style.left = Math.floor(scale * (sprite.pivot.x + sprite.size.x / 2) - spriteEditorPivot.offsetWidth / 2) + 'px';
        spriteEditorPivot.style.top = Math.floor(scale * (sprite.pivot.y + sprite.size.y / 2) - spriteEditorPivot.offsetHeight / 2) + 'px';

        document.getElementById('spriteEditorInfoName').innerHTML = `${spriteEditorAssetName}[${U}][${V}]`;

        if (sprite.$animationName) {
            document.getElementById('spriteEditorInfoAnimationName').innerHTML = `${spriteEditorAssetName}.${sprite.$animationName}`
            if (sprite.$animationIndex !== undefined) {
                const animation = spriteEditorAsset[sprite.$animationName];
                document.getElementById('spriteEditorInfoAnimationName').innerHTML += `[${sprite.$animationIndex}], extrapolate: "${animation.extrapolate || 'clamp'}"`;
            }
        }

        document.getElementById('spriteEditorInfoFrames').innerHTML = `frames: ${sprite.frames}`;

        // Position in the texture map after borders and regions are removed
        // and transpose is applied.
        const texturePixelX = spritePixelX + spriteEditorAsset.sprite_size.x * U;
        const texturePixelY = spritePixelY + spriteEditorAsset.sprite_size.y * V;
        
        const pixelValue = spriteEditorAsset.$uint16Data[texturePixelX + texturePixelY * spriteEditorAsset.size.x];
        const r = (pixelValue >>  0) & 0xf;
        const g = (pixelValue >>  4) & 0xf;
        const b = (pixelValue >>  8) & 0xf;
        const a = (pixelValue >> 12) & 0xf;

        document.getElementById('spriteEditorInfoXY').innerHTML = `(${spritePixelX}, ${spritePixelY})`;
        document.getElementById('spriteEditorInfoRGBA').innerHTML = `<code>#${r.toString(16)}${g.toString(16)}${b.toString(16)}${a.toString(16)}</code>`;

        spriteEditorHighlight.style.visibility = 'inherit';
        spriteEditor.style.cursor = 'crosshair';
    } else {
        // Out of bounds
        spriteEditorHighlight.style.visibility = 'hidden';
        spriteEditorPivot.style.visibility = 'hidden';
        spriteEditor.style.cursor = 'auto';

        for (let child of document.getElementById('spriteEditorInfo').children) {
            child.innerHTML = '';
        }

    }
}


function onSpriteEditorZoomSliderChange() {
    const slider = document.getElementById('spriteEditorZoomSlider');
    const alpha = (parseInt(slider.value) - parseInt(slider.min)) / (parseInt(slider.max) - parseInt(slider.min));
    const scale = Math.pow(2, -2 + 7 * alpha);

    const spriteEditorCanvas = document.getElementById('spriteEditorCanvas');
    spriteEditorCanvas.style.scale = scale;

    if (spriteEditorCanvas.onmousemove) {
        spriteEditorCanvas.onmousemove({clientX:0, clientY:0});
    }
}
