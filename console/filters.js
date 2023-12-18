/*
  Open Source under the BSD-2-Clause License:

  Copyright 2020 Morgan McGuire, https://casual-effects.com

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions
  are met:

  1. Redistributions of source code must retain the above copyright
  notice, this list of conditions and the following disclaimer.

  2. Redistributions in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in the
  documentation and/or other materials provided with the distribution.
  
  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
  "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
  LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
  A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
  HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
  SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
  LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
  DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
  THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
  OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
"use strict";

/* "1 euro filter"

   Tuning:
   - Decreasing the `minimumCutoff` [frequency] will decrease jitter.
   - Increasing the `speed` will decrease lag.
   
   Start with speed = 0 and adjust minCutoff until results are good
   for slowly-changing values. Then change the values quickly and
   increase speed until the lag is minimal (while still preserving
   jitter filtering).
   
   https://hal.inria.fr/hal-00670496/document
   https://jaantollander.com/noise-filtering-using-one-euro-filter.html
*/
function EuroFilter(minCutoff, speed) {
    if (minCutoff === undefined) { minCutoff = 1; }
    speed = speed || 0;
    minCutoff = Math.max(1e-4, minCutoff);
    speed = Math.max(0, speed);
    
    const derivativeCutoff = 1;
    this._param = {
        smoothValue:      NaN,
        smoothDerivative: 0,
        derivativeCutoff: derivativeCutoff,

        // f_c from the paper
        minCutoff:        minCutoff,

        // beta from the paper
        speed:            speed
    };
}


EuroFilter.prototype._smoothLerp = function(curr, prev, dt, cutoff) {
    // The 2pi is meaningless for a non-cyclic system, but we retain
    // it to match filter coefficients when porting from other systems.
    const r = 2 * Math.PI * cutoff * dt;
    const a = r / (r + 1);
    return a * curr + (1 - a) * prev;
}


EuroFilter.prototype.reset = function () { this._param.smoothValue = NaN; }

EuroFilter.prototype.get = function () { return this._param.smoothValue; }


// dt defaults to 1
EuroFilter.prototype.update = function (x, dt) {
    if (dt === undefined) { dt = 1; }
    const param = this._param, smoothLerp = this._smoothLerp;

    if ((param.smoothValue === undefined) || isNaN(param.smoothValue) || (dt <= 0) || (dt === Infinity)) {
        // First value
        console.assert(! isNaN(x));
        param.smoothValue = x;
        param.smoothDerivative = 0;
        return;
    }
    
    console.assert(dt !== 0);
    // Filter the derivative
    const dx = (x - param.smoothValue) / dt;
    param.smoothDerivative = smoothLerp(dx, param.smoothDerivative, dt, param.derivativeCutoff);

    // Filter the value
    const cutoff = param.minCutoff + Math.abs(param.smoothDerivative) * param.speed;
    param.smoothValue = smoothLerp(x, param.smoothValue, dt, cutoff);
}

/////////////////////////////////////////////////////////////////////////////////////////////////////

function EMWAFilter(hysteresis) {
    if (hysteresis === undefined) { hysteresis = 0.9};
    
    this._hysteresis = Math.min(1, Math.max(hysteresis, 0));
    this.reset();
}

EMWAFilter.prototype.reset = function() { this._smoothValue = NaN; }

EMWAFilter.prototype.get = function() { return this._smoothValue; }

EMWAFilter.prototype.update = function(value, dt) {
    if (dt === undefined) { dt = 1; }
    if (this._smoothValue === undefined || isNaN(this._smoothValue) || dt <= 0 || dt === Infinity) {
        this._smoothValue = value;
        return;
    }

    const h = Math.pow(this._hysteresis, 1 / dt);
    this._smoothValue = this._smoothValue * h + value * (1 - h);
}
