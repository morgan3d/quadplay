/* By Morgan McGuire @CasualEffects https://casual-effects.com LGPL 3.0 License*/
"use strict";

/* 
   The profiler manages both data displayed to the user and the graphics rate scaling.
*/

// Because browser timers are low precision (even performance.now is
// limited to 1ms for "security" on most browsers), we need to
// accumulate timing data over many frames to make it accurate.

function Profiler() {
    // Should be an integer multiple of the graphics period so that
    // graphics appears a representable number of times in the profile
    // data. The first interval is "1" to get results immediately.
    this.framesThisInterval       = 1;
    this.framesSinceIntervalStart = 0;
    this.intervalStartTime        = NaN;

    this.graphicsPeriod           = 1;

    this.lastGraphicsPeriodChangeTime = -Infinity;

    // Accumulated physics time for the interval.  Because the physics
    // time is micro-profiled, this does not give the accuracy of the
    // overall frame timing, but it does have better accuracy than
    // measuring a single frame.
    this.physicsAccumTime          = 0;
    this.graphicsAccumTime         = 0;
    this.logicAccumTime            = 0;

    const cutoff = 2e-3;
    const speed = 0.09;
    
    // Estimates of time spent on each part of the computation
    this.smoothLogicTime           = new EuroFilter(cutoff, speed);
    this.smoothPhysicsTime         = new EuroFilter(cutoff, speed);
    this.smoothGraphicsTime        = new EuroFilter(cutoff, speed);

    // Interval between frames, not time spent in computation
    this.smoothFrameTime           = new EuroFilter(cutoff, speed);

    // Used for measuring compute time in a frame
    this.currentFrameStartTime     = this.now();

    // Set to true when debugging the profiler itself
    // to track and display metadata
    this.debuggingProfiler         = false;
    this.reset();
}


// Return a timestamp
Profiler.prototype.now = function() {
    // In testing during January 2019, I found that Chrome has sub-millisecond
    // precision (accuracy unknown) and Firefox and Safari have millisecond 
    // precision, so performance.now is still better than Date.now.
    //
    // https://developer.mozilla.org/en-US/docs/Web/API/Performance/now
    return performance.now();
};


Profiler.prototype.startFrame = function () {
    this.currentFrameStartTime = this.now();
};


Profiler.prototype.reset = function() {
    this.intervalStartTime            = this.now();
    this.framesSinceIntervalStart     = 0;
    this.lastGraphicsPeriodChangeTime = this.now();
    this.framesThisInterval           = 1;
    this.physicsAccumTime             = 0;
    this.logicAccumTime               = 0;
    this.graphicsAccumTime            = 0;
    this.currentFrameStartTime        = this.now();
    this.graphicsPeriod               = 1;
    this.smoothLogicTime.reset();
    this.smoothPhysicsTime.reset();
    this.smoothGraphicsTime.reset();
    this.smoothFrameTime.reset();
};


Profiler.prototype.endFrame = function(physicsTime, graphicsTime) {
    ++this.framesSinceIntervalStart;
    const grossComputeTime = this.now() - this.currentFrameStartTime;
    this.physicsAccumTime += physicsTime;
    this.graphicsAccumTime += graphicsTime;
    this.logicAccumTime += grossComputeTime - physicsTime - graphicsTime;

    
    if (this.framesSinceIntervalStart < this.framesThisInterval) {
        // Not at the end of the interval
        return;
    }

    const intervalEndTime = this.now();
    // Update the counters
    {
        const N = this.framesThisInterval;
        const frameTime = (intervalEndTime - this.intervalStartTime) / N;
        
        // Compute the best estimate of real time spent on each operation
        const graphicsTime = this.graphicsAccumTime / N;
        const physicsTime = this.physicsAccumTime / N;
        const logicTime = Math.max(this.logicAccumTime / N, 0);
        
        this.smoothLogicTime.update(logicTime, N);
        this.smoothPhysicsTime.update(physicsTime, N);
        this.smoothGraphicsTime.update(graphicsTime, N);
        this.smoothFrameTime.update(frameTime, N);
    }
    
    // Reset for new frame
    this.physicsAccumTime = 0;
    this.graphicsAccumTime = 0;
    this.logicAccumTime = 0;
    this.framesSinceIntervalStart = 0;
    this.intervalStartTime = intervalEndTime;
    
    if (this.framesThisInterval === 1) {
        // End of the first frame. Change to a useful measurement
        // interval.
        this.framesThisInterval = 10;
    } else if (intervalEndTime - this.lastGraphicsPeriodChangeTime >= 1000) {
        // End of the interval and at a reasonable time at which to evaluate the
        // interval length and graphics period.

        const maxG = 6;
        // Graphics periods: 
        //   1 -> 60 Hz
        //   2 -> 30 Hz
        //   3 -> 20 Hz
        //   4 -> 15 Hz
        //   5 -> 12 Hz
        //   6 -> 10 Hz
        
        const logicTime    = this.smoothLogicTime.get();
        const physicsTime  = this.smoothPhysicsTime.get();
        const graphicsTime = this.smoothGraphicsTime.get();
        const frameTime    = this.smoothFrameTime.get();
        const G            = this.graphicsPeriod;

        // Estimates of the best frame time we might hit if graphicsPeriod changes 
        const minAchievableTime    = logicTime + physicsTime + graphicsTime * G / maxG;
        const expectedTimeAtLowerFramerate  = logicTime + physicsTime + graphicsTime * G / (G + 1);
        const expectedTimeAtCurrentFramerate = logicTime + physicsTime + graphicsTime * G;
        const expectedTimeAtHigherFramerate = logicTime + physicsTime + graphicsTime * G / (G - 1);
        let newG = G;

        if (frameTime > 18.5) {
            // Not making frame rate, and we've been in the current
            // mode for what we expected to be one second worth of
            // frames.
            if (((minAchievableTime <= 16) || (minAchievableTime < frameTime * 0.6)) && (G < maxG) && (QRuntime.mode_frames > 60 / G)) {
                // It is worth lowering the graphics rate, as it
                // should help us hit frame rate
                newG = G + 1;
                _systemPrint(`Lowered graphics update to ${60 / newG} Hz.\n` +
                             `  minAchievableTime = ${minAchievableTime}\n` +
                             `  expectedTimeAtLowerFramerate   = ${expectedTimeAtLowerFramerate}\n` +
                             `  expectedTimeAtCurrentFramerate = ${expectedTimeAtCurrentFramerate}\n` +
                             `  expectedTimeAtHigherFramerate  = ${expectedTimeAtHigherFramerate}\n` +
                             `  actualTimeAtCurrentFramerate   = ${frameTime}`, 'color:#F43');
            }
        } else if ((G > 1) && (expectedTimeAtHigherFramerate < 16)) {
            // We have headroom and should increase the graphics rate
            // back towards full framerate.
            newG = G - 1;
            _systemPrint(`Raised graphics update to ${60 / newG} Hz.\n` +
                         `  minAchievableTime = ${minAchievableTime}\n` +
                         `  expectedTimeAtLowerFramerate   = ${expectedTimeAtLowerFramerate}\n` +
                         `  expectedTimeAtCurrentFramerate = ${expectedTimeAtCurrentFramerate}\n` +
                         `  expectedTimeAtHigherFramerate  = ${expectedTimeAtHigherFramerate}\n` +
                         `  actualTimeAtCurrentFramerate   = ${frameTime}`, 'color:#18F');
        }
        
        if (newG !== G) {
            // Period changed
            this.graphicsPeriod = newG;

            // Want to target about 10 frames for interval length, but it
            // must be an integer multiple of newG.
            this.framesThisInterval = Math.ceil(10 / newG) * newG;
            this.lastGraphicsPeriodChangeTime = intervalEndTime;
        }
        
    }
};

const profiler = new Profiler();
