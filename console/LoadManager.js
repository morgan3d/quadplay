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

  Copyright 2018-2021 Morgan McGuire, https://casual-effects.com

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
    this.pendingRequests = 0;

    // 'accepting requests', 'loading', 'complete', 'failure'
    this.status = 'accepting requests';

    this.forceReload = options.forceReload || false;

    // Invoke when pendingRequests hits zero if status is not 'failure'
    this.callback = options.callback;
    this.errorCallback = options.errorCallback;
    this.jsonParser = options.jsonParser || 'local';
}


/** Invoked internally when a request is complete, or in rare cases by
    code that must explicitly manage the request count because of async 
    processing. */
LoadManager.prototype.markRequestCompleted = function (url, message, success) {
    --this.pendingRequests;

    if (success) {
        if ((this.pendingRequests === 0) && (this.status === 'loading')) {
            this.status = 'complete';
            // Throw away all of the data
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

   \param url String, mandatory
   \param type Type of data at the URL: 'text', 'json', 'arraybuffer', or 'image' (uses Image)
   \param postProcess(rawData, url) function
   \param callback(data, rawData, url, postProcess)
   \param errorCallback(reason, url) optional. Invoked on failure if some other load has not already failed.
          If the errorCallback returns a non-falsey value, then this is not treated as a global error and the 
          rest of loading continues. Otherwise loading ends immediately.
   \param warningCallback() optional.
   \param forceReload Boolean, optional. Defaults to LoadManage.forceReload

   You will receive a failure if the post process fails.
 */
LoadManager.prototype.fetch = function (url, type, postProcess, callback, errorCallback, warningCallback, forceReload) {
    console.assert(typeof type === 'string', 'type must be a string');
    console.assert((typeof postProcess === 'function') || !postProcess,
                   'postProcess must be a function, null, or undefined');
    if (forceReload === undefined) { forceReload = this.forceReload; }
    if (this.status === 'failure') { return; }
    const LM = this;

    //if (forceReload) { console.log('Forcing reload of ' + url); }
    console.assert(this.status !== 'complete',
                   'Cannot call LoadManager.fetch() after LoadManager.end(). url = ' + url);

    let rawEntry = this.resource.get(url);
    
    if (! rawEntry) {
        ++this.pendingRequests;
        
        // Not in the cache, so create it
        rawEntry = {
            url:            url,
            raw:            undefined,
            status:         'loading',
            failureMessage: undefined,
            post:           new Map()
        };
        
        this.resource.set(url, rawEntry);

        function onLoadSuccess() {
            if (LM.status === 'failure') { return; }

            try {
                // Run all post processing and success callbacks
                for (let [p, v] of rawEntry.post) {
                    v.value = p ? p(rawEntry.raw, rawEntry.url) : rawEntry.raw;
                    
                    for (let c of v.callbackArray) {
                        // Note that callbacks may trigger their own loads, which
                        // increase LM.pendingRequests
                        if (c) { c(v.value, rawEntry.raw, rawEntry.url, p); }
                    }
                }
                rawEntry.status = 'success';
                LM.markRequestCompleted(rawEntry.url, '', true);
            } catch (e) {
                // The load succeeded, but a callback has failed
                console.trace();
                console.log(e + ' while loading ' + url);
                rawEntry.failureMessage = '' + e;
                onLoadFailure();
            }
        }

        function onLoadFailure() {
            if (LM.status === 'failure') { return; }
            rawEntry.status = 'failure';

            let atLeastOne = false;
            let allTrue = true;
            // Run all failure callbacks
            for (let [p, v] of rawEntry.post) {
                for (let c of v.errorCallbackArray) {
                    if (c) {
                        atLeastOne = true;
                        allTrue = c(rawEntry.failureMessage, rawEntry.url) && allTrue;
                    }
                } // for each callback
            }

            // Do we treat this as a 'success'?
            const considerSuccess = atLeastOne && allTrue;
            
            LM.markRequestCompleted(rawEntry.url, rawEntry.failureMessage, considerSuccess);
        }        

        // Safari slows down badly when it must handle too many async requests
        // at the same time
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        const MAX_REQUESTS = isSafari ? 50 : 100;
        const REQUEST_DELAY_MILLISECONDS = 20;
        
        // Fire off the asynchronous request
        if (type === 'image') {
            const image = new Image();
            rawEntry.raw = image;
            if (LM.crossOrigin) {
                // Allow loading from other domains and reading the pixels (CORS).
                // Works only if the other site allows it; which github does and
                // for which we can use a proxy and an XMLHttpRequest as an
                // annoying workaround if necessary.
                image.crossOrigin = LM.crossOrigin;
            }
            image.onload = onLoadSuccess;
            image.onerror = onLoadFailure;

            const sendRequest = function () {
                image.src = url + (forceReload && (url.indexOf('?') === -1) ? ('?refresh=' + Date.now()) : '');
            };
            
            if (this.pendingRequests > MAX_REQUESTS) {
                // Delay the fetch to avoid overloading the browser
                setTimeout(sendRequest, REQUEST_DELAY_MILLISECONDS * this.pendingRequests);
            } else {
                sendRequest();
            }
            
        } else {
            const xhr = new XMLHttpRequest();

            // Force a check for the latest file using a query string
            xhr.open('GET', url + (forceReload ? ('?refresh=' + Date.now()) : ''), true);

            if (LM.forceReload) {
                // Set headers attempting to force a real refresh;
                // Chrome still doesn't always obey these in some
                // recent versions, which is why we also set the
                // query above.
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
            
            xhr.onload = function() {
                const status = xhr.status;
                if (status === 200) {
                    if (xhr.response !== undefined) {
                        // now parse
                        if ((LM.jsonParser !== 'remote') && (type === 'json')) {
                            try {
                                rawEntry.raw = LM.parseJSON(xhr.response, url, warningCallback);
                                onLoadSuccess();
                            } catch (e) {
                                // Parsing failed
                                rawEntry.failureMessage = '' + e;
                                rawEntry.failureMessage = rawEntry.failureMessage.replace(/position (\d*)/, function (match, pos) {
                                    const chr = parseInt(pos);
                                    const line = (xhr.response.substring(0, chr).match(/\n/g)||[]).length + 1;
                                    return 'line ' + line;
                                });
                                onLoadFailure();
                            }
                        } else {
                            rawEntry.raw = xhr.response;
                            onLoadSuccess();
                        }
                    } else {
                        rawEntry.failureMessage = "File was in the incorrect format";
                        onLoadFailure();
                    }
                } else {
                    rawEntry.failureMessage = "Server returned error " + status;
                    onLoadFailure();
                }
            };

            xhr.onerror = function (e) {
                rawEntry.failureMessage = xhr.statusText;
                onLoadFailure();
            };

            const sendRequest = function() {
                try {
                    xhr.send();
                } catch (e) {
                    rawEntry.failureMessage = '' + e;
                    onLoadFailure();
                }
            };

            if (this.pendingRequests > MAX_REQUESTS) {
                // Delay the fetch to avoid overloading the browser
                setTimeout(sendRequest, REQUEST_DELAY_MILLISECONDS * this.pendingRequests);
            } else {
                sendRequest();
            }

        } // if XMLHttp
    }

    let postEntry = rawEntry.post.get(postProcess);
    if (! postEntry) {
        // This is the first use of this post processing
        if (rawEntry.status === 'success') {
            // Run the post processing right now
            postEntry = {
                value: postProcess ? postProcess(rawEntry.raw, rawEntry.url) : rawEntry.raw,
            };
            if (callback) { callback(postEntry.value, rawEntry.raw, url, postProcess); }
        } else if (rawEntry.status === 'failure') {
            if (errorCallback) { errorCallback(rawEntry.failureMessage, url); }
        } else {
            // Schedule the callback
            postEntry = {
                value: null,
                callbackArray: [callback],
                errorCallbackArray: [errorCallback]
            };
        }
        rawEntry.post.set(postProcess, postEntry);
    } else if (rawEntry.status === 'success') {
        // Run the callback now
        if (callback) { callback(postEntry.value, rawEntry.raw, url, postProcess); }
    } else if (rawEntry.status === 'failure') {
        // Run the callback now
        if (errorCallback) { errorCallback(rawEntry.failureMessage, url); }
    } else {
        // Schedule the callback
        postEntry.callbackArray.push(callback);
        postEntry.errorCallbackArray.push(errorCallback);
    }
}


/** The URL is used only for reporting warnings (not errors) */
LoadManager.prototype.parseJSON = function (text, url, warningCallback) {
    if (this.jsonParser === 'permissive') {
        return WorkJSON.parse(text);
    } else {
        return JSON.parse(text);
    }
}


/** 
    Call after the last fetch.
*/
LoadManager.prototype.end = function () {
    if (this.status !== 'failure') {
        console.assert(this.status === 'accepting requests');

        if (this.pendingRequests === 0) {
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
