/**
  \file LoadManager.js

  Load manager for asynchronous resource loading requests in
  complicated loading trees, with post processing of resources and
  caching. This is useful for loading files that recursively trigger
  the loading of other files without having to manage promises or lots
  of callbacks explicitly.

  The routines are:

  - loadManager = new LoadManager()
  - loadManager.fetch()
  - loadManager.end()
  - LoadManager.fetchOne() to directly run a single fetch _without_ a
    load manager instance. This does not allow recursive calls, of course.
 
  ----------------------------------------------------

  This implementation uses XMLHttpRequest internally. There is a newer
  browser API for making HTTP requests called Fetch
  (https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)
  that uses Promises; it is more elegant in some ways but also more
  complicated because it relies on more language features. Since the
  current implementation is working fine, I don't intend to port to
  the Fetch API until some critical feature of it (such as the explicit
  headers or credentialing) is required.

  ----------------------------------------------------

  Open Source under the BSD-2-Clause License:

  Copyright 2018-2025 Morgan McGuire, https://casual-effects.com

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

// We don't support a native 'xml' fetch because XMLHttpRequest.responseXML
// doesn't work within web workers.

/** Begin a series of fetches. Options:

    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    {
      callback : function () {...},
      errorCallback : function (why) {...},

      // Options are 'remote', 'local', and 'permissive'
      //  'remote' parses on the server
      //  'local' gives better error messages
      //  'permissive' allows comments, trailing commas, and `backquote multiline strings`
      jsonParser: 'local',

      // If true, append '?' to each URL when fetching to force 
      // it to be reloaded from the server, or at least validated.
      // Defaults to false.
      forceReload : false
    }
    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

    Invoke \a callback when all fetch() calls have been processed, 
    or \a errorCallback when the first fails.  */
function LoadManager(options) {

    options = options || {};

    // Map from url to:
    // {
    //   raw      : result of the fetch
    //   status   : 'loading', 'success', 'failure'
    //   post     : Map from post-processing functions (and null) to:
    //      {
    //            value: value
    //            callbacks: array of callbacks to invoke when data arrives and is post-processed
    //            errorCallbacks: etc.
    //      }
    // }
    
    this.resource = new Map();
    this.crossOrigin = 'anonymous';
    this.pendingFetches = 0;

    // 'accepting requests', 'loading', 'complete', 'failure'
    this.status = 'accepting requests';

    this.forceReload = options.forceReload || false;

    // Invoke when pendingFetches hits zero if status is not 'failure'
    this.callback = options.callback;
    this.errorCallback = options.errorCallback;
    this.jsonParser = options.jsonParser || 'local';
}


/** Invoked internally when a request is complete, or in rare cases by
    code that must explicitly manage the request count because of async 
    processing. The url is only used for error messages, it is not
    indicating that ALL processing of that url is complete, only that 
    some request associated with the url has completed (e.g., may be async processing)*/
LoadManager.prototype.markRequestCompleted = function (url, message, success) {
    --this.pendingFetches;

    if (success) {
        if ((this.pendingFetches === 0) && (this.status === 'loading')) {
            this.status = 'complete';
            // Throw away all of the data now that we're done
            this.resource = null;
            if (this.callback) { this.callback(); }
        }
    } else {
        this.status = 'failure';
        this.resource = null;
        if (this.errorCallback) { this.errorCallback(message + ' for ' + url); }
    }
};


/**
   Invoke \a callback on the contents of \a url after the specified
   post-processing function, or \a errorCallback on failure. Results
   are cached both before and *after* post-processing, so that there
   is no duplication of the HTTP request, the post processing, or any
   of the storage.

   Set \a postProcessing to null to get the raw result in the callback.

   \param url:String, mandatory
   \param type:String. JavaScript-MIME type of data at the URL (not the type of data that should be passed to the callback): 'text', 'json', 'arraybuffer', or 'image' (uses Image)
   \param postProcess: function(rawData, url). Function to on over the rawData before it is passed to callback. This may return either a promise or the actual value. 
          The value is cached based on the url and this function.
   \param callback : function(data, rawData, url, postProcess)
   \param errorCallback:function(reason, url) optional. Invoked on failure if some other load has not already failed.
          If the errorCallback returns a non-falsey value, then this is not treated as a global error and the 
          rest of loading continues. Otherwise loading ends immediately.
   \param warningCallback:function() optional.
   \param forceReload:Boolean, optional. Defaults to `LoadManage.forceReload`

   You will receive a errorCallback() if the postProcess throws an exception.
 */
LoadManager.prototype.fetch = function (url, type, postProcess, callback, errorCallback, warningCallback, forceReload) {
    console.assert(typeof type === 'string', 'type must be a string');
    console.assert((typeof postProcess === 'function') || !postProcess,
                   'postProcess must be a function, null, or undefined');

    const LM = this;

    // If the entire LoadManager has already failed, ignore this fetch
    if (LM.status === 'failure') { return; }

    // Track that there is going to be new work to be done before
    // the entire LM load operation is complete. Due to LM caching,
    // we may end up immediately marking this request as complete synchronously
    // within this function.
    ++LM.pendingFetches;

    // Apply default
    if (forceReload === undefined) { forceReload = LM.forceReload; }

    console.assert(LM.status !== 'complete',
                   'Cannot call LoadManager.fetch() after LoadManager.end(). url = ' + url);

    // The fetch operation that the load manager uses to track progress of asynchronous fetch
    // and callbacks. This is also used as a memoization cache for multiple loads within a LoadManger
    // session. It is NOT used as a cache between sessions in the current implementation.

    // TODO: only cache with same callback and url!
    let operation = undefined;//LM.resource.get(url);
    
    if (operation) {
        // If the operation in progress failed, then the LM should have
        // been marked failed already
        console.assert(operation.status !== 'failure');

        if (operation.status !== 'success') {
            // This operation is already in progress but has not completed
            // TODO
        }
    }

    // Invoke when the entire operation has failed
    function failOperation() {
        operation.failureMessage += ' during ' + operation.status;
        const considerSuccess = errorCallback ? errorCallback(operation.failureMessage, url) : false;                
        operation.status = 'failure';
        LM.markRequestCompleted(operation.url, operation.failureMessage, considerSuccess);
    }


    function runHttpRequest() {
        // Create the entry if it does not already exist, or override it if we are forcing a reload
        if (! operation || forceReload) {
            operation = {
                url:            url,
                // What comes back from the fetch
                rawData:        undefined,
                status:         'http fetch',
                failureMessage: undefined,

                // Maps post-process procedures to values they produced. This includes the default
                // entry for undefined, which is the rawData directly.
                dataCache: new Map()
            };
            
            // Store the entry
            LM.resource.set(url, operation);

            // Safari slows down badly when it must handle too many async requests
            // at the same time, so we alter the constants for it
            const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
            const MAX_REQUESTS = isSafari ? 50 : 100;
            const REQUEST_DELAY_MILLISECONDS = 20;

            // Add a '?' query if required to force a reload instead of allowing the browser cache
            // to intervene
            const loadURL = url + (forceReload && (url.indexOf('?') === -1) ? ('?refresh=' + Date.now()) : '');
            
            // Fire off the asynchronous HTTP request. Image data has a special path because it can be
            // loaded without an explicit HTTP call but instead via the JavaScript image loading routines.
            if (type === 'image') {
                const image = new Image();
                operation.rawData= image;
                if (LM.crossOrigin) {
                    // Allow loading from other domains and reading the pixels (CORS).
                    // Works only if the other site allows it; which github does and
                    // for which we can use a proxy and an XMLHttpRequest as an
                    // annoying workaround if necessary.
                    image.crossOrigin = LM.crossOrigin;
                }
                image.onload = runPostProcess;
                image.onerror = failOperation;

                const sendRequest = function () {
                    image.src = loadURL;
                };
                
                if (this.pendingFetches > MAX_REQUESTS) {
                    // Delay the fetch to avoid overloading the browser
                    setTimeout(sendRequest, REQUEST_DELAY_MILLISECONDS * this.pendingFetches);
                } else {
                    sendRequest();
                }
                
            } else {
                const xhr = new XMLHttpRequest();

                // Force a check for the latest file using a query string
                xhr.open('GET', loadURL, true);

                if (LM.forceReload) {
                    // Set headers attempting to force a real refresh;
                    // Chrome still doesn't always obey these in some
                    // recent versions, which is why we also set the
                    // '?' query above.
                    xhr.setRequestHeader('cache-control', 'no-cache, must-revalidate, post-check=0, pre-check=0');
                    xhr.setRequestHeader('cache-control', 'max-age=0');
                    xhr.setRequestHeader('expires', '0');
                    xhr.setRequestHeader('expires', 'Tue, 01 Jan 1980 1:00:00 GMT');
                    xhr.setRequestHeader('pragma', 'no-cache');
                }
                
                if ((LM.jsonParser !== 'remote') && (type === 'json')) {
                    xhr.responseType = 'text';
                } else {
                    xhr.responseType = type;
                }
                
                // On load, perform parsing of the HTTP response packet, and then hand off to the success/failure routine
                xhr.onload = function() {
                    const status = xhr.status;
                    // 200 = OK
                    if (status === 200) { 
                        if (xhr.response !== undefined) {
                            // now parse
                            if ((LM.jsonParser !== 'remote') && (type === 'json')) {
                                try {
                                    operation.rawData = LM.parseJSON(xhr.response, url, warningCallback);
                                    console.assert(operation.rawData);
                                    runPostProcess();
                                } catch (error) {
                                    // Parsing failed
                                    operation.failureMessage = error.toString();
                                    operation.failureMessage = operation.failureMessage.replace(/position (\d*)/, function (match, pos) {
                                        const chr = parseInt(pos);
                                        const line = (xhr.response.substring(0, chr).match(/\n/g)||[]).length + 1;
                                        return 'line ' + line;
                                    });
                                    failOperation();
                                }
                            } else {
                                operation.rawData = xhr.response;
                                console.assert(operation.rawData);
                                runPostProcess();
                            }
                        } else {
                            operation.failureMessage = "File was in the incorrect format";
                            failOperation();
                        }
                    } else {
                        operation.failureMessage = "Server returned error " + status;
                        failOperation();
                    }
                };

                xhr.onerror = function (error) {
                    //console.dir(xhr.statusText);
                    operation.failureMessage = xhr.statusText;
                    failOperation();
                };

                const sendRequest = function() {
                    try {
                        xhr.send();
                    } catch (error) {
                        //console.dir(error);
                        operation.failureMessage = error.toString();
                        failOperation();
                    }
                };

                if (LM.pendingFetches > MAX_REQUESTS) {
                    // Delay the fetch to avoid overloading the browser
                    setTimeout(sendRequest, REQUEST_DELAY_MILLISECONDS * LM.pendingFetches);
                } else {
                    sendRequest();
                }

            } // if XMLHttp
        } else {
            // This will be overwritten immediately
            operation.status = 'http fetch';
            console.assert(operation.rawData);
            runPostProcess();
        }
    } // runHttpRequest()

    // Executes the post-process step. This is always invoked, but may just pass through
    // the data to the callback if postProcess === undefined
    function runPostProcess() {
        operation.status = 'postprocess';
        console.assert(operation.rawData);

        // If the HTTP request succeeded but the entire LM has failed in the meantime
        // due to another async fetch, then stop processing this fetch.
        if (LM.status === 'failure') { return; }

        // See if this postProcess function has already run on the rawData.
        // Note that if this was a forced reload, the post cache was wiped.
        if (operation.dataCache.has(postProcess)) {
            // Post-processing is already available for rawData in the dataCache.
            // Proceed immediately to the callback
            runCallback();
        } else {
            const dataOrPromise = postProcess ? postProcess(operation.rawData, operation.url) : operation.rawData;
                
            if (dataOrPromise instanceof Promise) {
                // The postProcess returned a Promise, so we must async wait for that promise to complete.                
                dataOrPromise.then(data => {
                    console.assert(! (data instanceof Promise));
                    operation.dataCache.set(postProcess, data);
                    runCallback();
                }).catch(error => {
                    operation.failureMessage = error.toString();
                    failOperation();
                });
            } else {
                // Store into the cache and proceed to the callback 
                // (which will pull the value out of the cache)
                operation.dataCache.set(postProcess, dataOrPromise);
                runCallback();
            } // if promise
        } // if dataCache
    } // runPostProcess()

    // Execute the callback(). Triggered by runPostProcess, either synch or async
    // depending on the value of postProcess.
    function runCallback() {
        operation.status = 'callback';
        console.assert(operation.dataCache.has(postProcess));
        const data = operation.dataCache.get(postProcess);
        console.assert(data);
        console.assert(! (data instanceof Promise));

        try {
            // Note that callbacks may trigger their own loads, which
            // increase LM.pendingFetches
            if (callback) { 
                callback(data, operation.rawData, operation.url, postProcess); 
            }

            // This line is the only way for the entire operation to succeed
            operation.status = 'success';
            LM.markRequestCompleted(operation.url, '', true);

        } catch (error) {
            // The load succeeded, but a callback has failed due to an exception
            console.trace();
            console.log(callback);
            console.log(error + ' during callback while loading ' + url);
            operation.failureMessage = error.toString();

            failOperation();
        } // try
    } // runCallback()

    // Kick off the process
    runHttpRequest();
}


/** The URL is used only for reporting warnings (not errors) */
LoadManager.prototype.parseJSON = function (text, url, warningCallback) {
    let result;
    if (this.jsonParser === 'permissive') {
        result = WorkJSON.parse(text);
    } else {
        result = JSON.parse(text);
    }

    return result;
}


/** 
    Call after the last fetch.
*/
LoadManager.prototype.end = function () {
    if (this.status !== 'failure') {
        console.assert(this.status === 'accepting requests');

        if (this.pendingFetches === 0) {
            // Immediately invoke the callback
            this.status = 'complete';
            // Throw away all of the data
            this.resource = null;
            if (this.callback) { this.callback(); }
        } else {
            // Tell the loading callbacks that they
            // should invoke the completion callback.
            this.status = 'loading';
        }
    }
}

/** Fetch a single url without a LoadManager instance. */
LoadManager.fetchOne = function (options, ...args) {
    console.assert(typeof options === 'object', 'First argument must be an options argument');
    const manager = new LoadManager(options);
    manager.fetch(...args);
    manager.end();
}
