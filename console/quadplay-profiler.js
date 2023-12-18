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

    // Time spent purely on the virtual CPU for graphics. This can be
    // severely reduced by altering frame rate.
    this.graphicsAccumTime         = 0;

    // Time spent on the virtual CPU on logic tasks (not draw call submission or physics)
    this.logicAccumTime            = 0;

    // Time spent on the virtual GPU
    this.gpuAccumTime              = 0;

    // Number of frames that would have actually been rendered
    // (taking graphicsPeriod into account) that were in fact
    // missed due to backlog. Only tracked in threaded mode
    this.missedFrames              = 0;

    const cutoff = 2e-3;
    const speed = 0.09;
    
    // Estimates of time spent on each part of the computation on the
    // virtual CPU
    this.smoothLogicTime           = new EuroFilter(cutoff, speed);
    this.smoothPhysicsTime         = new EuroFilter(cutoff, speed);
    this.smoothGraphicsTime        = new EuroFilter(cutoff, speed);

    // Graphics time on the virtual GPU, per frame *actually processed* by the
    // GPU. This is updated by submitFrame() from quadplay-browser.js.
    this.smoothGPUTime             = new EuroFilter(cutoff, speed);

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
    this.gpuAccumTime                 = 0;
    this.currentFrameStartTime        = this.now();
    this.missedFrames                 = 0;
    this.graphicsPeriod               = 1;
    this.smoothLogicTime.reset();
    this.smoothPhysicsTime.reset();
    this.smoothGraphicsTime.reset();
    this.smoothGPUTime.reset();
    this.smoothFrameTime.reset();
    this.failuresAtMaxRate            = 0;
};


Profiler.prototype.endFrame = function(newPhysicsTime, newGraphicsTime, newLogicToGraphicsTimeShift, newMissedFrames) {
    ++this.framesSinceIntervalStart;
    const grossComputeTime = this.now() - this.currentFrameStartTime;
    this.physicsAccumTime += newPhysicsTime;

    let newLogicTime = grossComputeTime - newPhysicsTime;

    // Estimate 8% plus measured time is spent on graphics draw call
    // submission
    newLogicToGraphicsTimeShift += newLogicTime * 0.08 / this.graphicsPeriod;
    
    this.graphicsAccumTime += newGraphicsTime + newLogicToGraphicsTimeShift;
    this.logicAccumTime += Math.max(0, newLogicTime - newLogicToGraphicsTimeShift);

    this.missedFrames += newMissedFrames;

    if (this.framesSinceIntervalStart < this.framesThisInterval) {
        // Not at the end of the interval
        return;
    }

    const intervalEndTime = this.now();
    // Update the counters
    let cpuGraphicsTime;
    {
        const N = this.framesThisInterval;
        const frameTime = (intervalEndTime - this.intervalStartTime) / N;
        
        // Compute the best estimate of real time spent on each operation.
        // The graphics time is the actual time spent there, which takes
        // the reduced refresh rate into account because the accumulator
        // will receive zero new time above in certain frames.
        let graphicsTime = this.graphicsAccumTime / N;
        let physicsTime  = this.physicsAccumTime / N;
        let logicTime    = this.logicAccumTime / N;
        
        this.smoothLogicTime.update(logicTime, N);
        this.smoothPhysicsTime.update(physicsTime, N);
        this.smoothGraphicsTime.update(graphicsTime, N);
        this.smoothFrameTime.update(frameTime, N);
    }

    // How much more graphics on the GPU would have cost if we hadn't
    // missed frames
    const missedFrameCompensation = this.framesThisInterval / Math.max(this.framesThisInterval - this.missedFrames * this.graphicsPeriod, 1);
    console.assert(this.framesThisInterval >= this.missedFrames * this.graphicsPeriod);

    // Reset for new interval
    this.missedFrames = 0;
    this.physicsAccumTime = 0;
    this.graphicsAccumTime = 0;
    this.logicAccumTime = 0;
    this.framesSinceIntervalStart = 0;
    this.intervalStartTime = intervalEndTime;
    
    if (this.framesThisInterval === 1) {
        // End of the first frame. Change to a useful measurement
        // interval. Note that there will be some roundoff for
        // the cost of graphics based on the interval since it
        // isn't running every frame. Use 15 so that we see
        // no roundoff effects at 15, 30, 60 Hz but are still very
        // responsive at lower framerates.
        this.framesThisInterval = 15;
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
        
        const G            = this.graphicsPeriod;

        // These times already account for frame rate scaling
        const logicTime    = this.smoothLogicTime.get();
        const physicsTime  = this.smoothPhysicsTime.get();
        const graphicsTime = this.smoothGraphicsTime.get();
        const fixedCPUTime = logicTime + physicsTime;

        console.assert(! isNaN(this.smoothGPUTime.get()));

        // Values that can be affected by changing the graphics rate
        const variableCPUTime = graphicsTime;

        // Be a little conservative on variableGPUTime to minimize thrash based
        // on small integer numbers of missed frames
        const variableGPUTime = $THREADED_GPU ? 1.05 * this.smoothGPUTime.get() * missedFrameCompensation / G : 0;
        
        const frameTime    = Math.max(this.smoothFrameTime.get(), variableGPUTime);

        console.assert(! isNaN(frameTime));
        // Estimates of the best frame time we might hit if graphicsPeriod changes
        let minAchievableTime, expectedTimeAtLowerFramerate, expectedTimeAtCurrentFramerate, expectedTimeAtHigherFramerate;

        minAchievableTime              = Math.max(fixedCPUTime + variableCPUTime * G / maxG, variableGPUTime * G / maxG);
        expectedTimeAtLowerFramerate   = Math.max(fixedCPUTime + variableCPUTime * G / (G + 1), variableGPUTime * G / (G + 1));
        expectedTimeAtCurrentFramerate = Math.max(fixedCPUTime + variableCPUTime, variableGPUTime);
        expectedTimeAtHigherFramerate  = Math.max(fixedCPUTime + variableCPUTime * G / Math.max(G - 1, 0.5), variableGPUTime * G / Math.max(G - 1, 0.5));

        let newG = G;

        if (frameTime > 19 && QRuntime.game_frames > 200) {
            // We're many frames in and can't keep up.  Try disabling
            // bloom.
            allow_bloom = false;
        }


        // Sometimes the JIT runs or another scheduling event occurs
        // and the actual time is way out of sync with the expected
        // time. Do not drop the framerate in this case.
        if (
            // Not making frame rate
            (frameTime > 17.5) &&
                
            // ...and our timing estimates seem valid (i.e., the JIT
            // didn't just run or something weird that might throw off
            // timing)
            (frameTime < 3 * expectedTimeAtCurrentFramerate)
	) {
            if (
                // The best we can possibly by graphics scaling 
                //((minAchievableTime <= 16.5) || (minAchievableTime < frameTime * 0.6))  &&

                // Not at the lowest frame rate yet
                (G < maxG) &&

                // We've been in the current mode for what we expected
                // to be one second worth of frames, so this is
                // probably steady state.
                (QRuntime.mode_frames > 60 / G)) {

		if (G === 1) {
		    ++this.failuresAtMaxRate;
		}
		
                // It is worth lowering the graphics rate, as it
                // should help us hit frame rate
                newG = G + 1;

                if (! deployed) {
                $systemPrint(`\nLowered graphics update from ${60 / G} to ${60 / newG} Hz because:\n` +
                             `  minAchievableTime = ${minAchievableTime.toFixed(2)}\n` +
                             `  expectedTimeAtLowerFramerate   = ${expectedTimeAtLowerFramerate.toFixed(2)}\n` +
                             `  expectedTimeAtCurrentFramerate = ${expectedTimeAtCurrentFramerate.toFixed(2)}\n` +
                             `  expectedTimeAtHigherFramerate  = ${expectedTimeAtHigherFramerate.toFixed(2)}\n` +
                             `  actualTimeAtCurrentFramerate   = ${frameTime.toFixed(2)}`, 'color:#F43');
                }
            }
        } else if (

            // Not at the highest graphics frame rate
            (G > 1) &&

            // We're plausibly performing well (being pretty liberal
            // about it due to odd performance numbers on low end
            // machines when using infrequent timers)
            (frameTime < 30) &&
            
            // Increasing frame rate should still keep us under the
            // limit
            (expectedTimeAtHigherFramerate < 16.1) &&
            
            // Even given the error in our current estimates, the new
            // frame rate should still be pretty close to 60
            // Hz. Sometimes on RPi the actual frame time reports low,
            // and then when we change rate it is able to catch up, so
            // be very liberal here on timing
            (expectedTimeAtHigherFramerate * Math.min(1.0, frameTime / expectedTimeAtCurrentFramerate) < 25) &&

	    // Not thrashing between 30 and 60 Hz
	    !(this.failuresAtMaxRate > 5 && G === 2)

	) {
            // We have headroom and should increase the graphics rate
            // back towards full framerate.
            newG = G - 1;

            if (! deployed) {
            $systemPrint(`\nRaised graphics update from ${60 / G} to ${60 / newG} Hz because:\n` +
                         `  minAchievableTime = ${minAchievableTime.toFixed(2)}\n` +
                         `  expectedTimeAtLowerFramerate   = ${expectedTimeAtLowerFramerate.toFixed(2)}\n` +
                         `  expectedTimeAtCurrentFramerate = ${expectedTimeAtCurrentFramerate.toFixed(2)}\n` +
                         `  expectedTimeAtHigherFramerate  = ${expectedTimeAtHigherFramerate.toFixed(2)}\n` +
                         `  actualTimeAtCurrentFramerate   = ${frameTime.toFixed(2)}`, 'color:#1E8');
            }
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
