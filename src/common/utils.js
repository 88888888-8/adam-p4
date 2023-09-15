/*
 * Copyright Adam Pritchard 2013
 * MIT License : http://adampritchard.mit-license.org/
 */

/*
 * Utilities and helpers that are needed in multiple places.
 */

;(function() {

"use strict";
/*global module:false, chrome:false*/


// Assigning a string directly to `element.innerHTML` is potentially dangerous:
// e.g., the string can contain harmful script elements. (Additionally, Mozilla
// won't let us pass validation with `innerHTML` assignments in place.)
// This function provides a safer way to append a HTML string into an element.
function saferSetInnerHTML(parentElem, htmlString) {
  // Jump through some hoops to avoid using innerHTML...

  var range = parentElem.ownerDocument.createRange();
  range.selectNodeContents(parentElem);

  var docFrag = range.createContextualFragment(htmlString);
  docFrag = sanitizeDocumentFragment(docFrag);

  range.deleteContents();
  range.insertNode(docFrag);
  range.detach();
};


// Approximating equivalent to assigning to `outerHTML` -- completely replaces
// the target element with `htmlString`.
// Note that some caveats apply that also apply to `outerHTML`:
// - The element must be in the DOM. Otherwise an exception will be thrown.
// - The original element has been removed from the DOM, but continues to exist.
//   Any references to it (such as the one passed into this function) will be
//   references to the original.
function saferSetOuterHTML(elem, htmlString) {
  if (!isElementinDocument(elem)) {
    throw new Error('Element must be in document');
    return;
  }

  var range = elem.ownerDocument.createRange();
  range.selectNode(elem);

  var docFrag = range.createContextualFragment(htmlString);
  docFrag = sanitizeDocumentFragment(docFrag);

  range.deleteContents();
  range.insertNode(docFrag);
  range.detach();
};


// Removes potentially harmful elements and attributes from `docFrag`.
// Returns a santized copy.
function sanitizeDocumentFragment(docFrag) {
  var i;

  // Don't modify the original
  docFrag = docFrag.cloneNode(true);

  var scriptTagElems = docFrag.querySelectorAll('script');
  for (i = 0; i < scriptTagElems.length; i++) {
    scriptTagElems[i].parentNode.removeChild(scriptTagElems[i]);
  }

  function cleanAttributes(node) {
    var i;

    if (typeof(node.removeAttribute) === 'undefined') {
      // We can't operate on this node
      return;
    }

    // Remove event handler attributes
    for (i = node.attributes.length-1; i >= 0; i--) {
      if (node.attributes[i].name.match(/^on/)) {
        node.removeAttribute(node.attributes[i].name);
      }
    }
  }

  walkDOM(docFrag.firstChild, cleanAttributes);

  return docFrag;
}


// Walk the DOM, executing `func` on each element.
// From Crockform.
function walkDOM(node, func) {
  func(node);
  node = node.firstChild;
  while(node) {
    walkDOM(node, func);
    node = node.nextSibling;
  }
}


function isElementinDocument(element) {
  var doc = element.ownerDocument;
  while (element = element.parentNode) {
    if (element === doc) {
      return true;
    }
  }
  return false;
}


// Take a URL that refers to a file in this extension and makes it absolute.
// Note that the URL *must not* be relative to the current path position (i.e.,
// no "./blah" or "../blah"). So `url` must start with `/`.
function getLocalURL(url) {
  if (url[0] !== '/') {
    throw 'relative url not allowed: ' + url;
  }

  if (url.indexOf('://') >= 0) {
    // already absolute
    return url;
  }

  if (typeof(chrome) !== 'undefined') {
    return chrome.extension.getURL(url);
  }
  else {
    // Mozilla platform.
    // HACK The proper URL depends on values in `chrome.manifest`. But we "know"
    // that there are only a couple of locations we request from, so we're going
    // to branch depending on the presence of "common".

    var COMMON = '/common/';
    var CONTENT = '/firefox/chrome/'

    if (url.indexOf(COMMON) === 0) {
      return 'resource://markdown_here_common/' + url.slice(COMMON.length);
    }
    else if (url.indexOf(CONTENT) === 0) {
      return 'chrome://markdown_here/' + url.slice(CONTENT.length);
    }
  }

  throw 'unknown url type: ' + url;
}


// Makes an asynchrous XHR request for a local file (basically a thin wrapper).
// `mimetype` is optional. `callback` will be called with the responseText as
// argument.
// Throws exception on error. This should never happen.
function getLocalFile(url, mimetype, callback) {
  if (!callback) {
    // optional mimetype not provided
    callback = mimetype;
    mimetype = null;
  }

  var xhr = new XMLHttpRequest();
  if (mimetype) {
    xhr.overrideMimeType(mimetype);
  }
  xhr.open('GET', url);
  xhr.onreadystatechange = function() {
    if (this.readyState === this.DONE) {
      // Assume 200 OK -- it's just a local call
      callback(this.responseText);
    }
  };

  xhr.onerror = function(e) {
    // We're only requesting local files, so this should not happen.
    throw e;
  };

  xhr.send();
}


// Does async XHR request to get data at `url`, then passes it to `callback`
// Base64-encoded.
// Intended to be used get the logo image file in a form that can be put in a
// data-url image element.
// Throws exception on error. This should never happen.
function getLocalFileAsBase64(url, callback) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url);
  xhr.responseType = 'arraybuffer';

  xhr.onload = function() {
    if (this.readyState === this.DONE) {
      // Assume 200 OK -- we only use this for local requests
      var uInt8Array = new Uint8Array(this.response);
      var i = uInt8Array.length;
      var binaryString = new Array(i);
      while (i--)
      {
        binaryString[i] = String.fromCharCode(uInt8Array[i]);
      }
      var data = binaryString.join('');

      var base64Data = window.btoa(data);

      callback(base64Data);
    }
  };

  xhr.onerror = function(e) {
    // We're only requesting local files, so this should not happen.
    throw e;
  };

  xhr.send();
}


var MARKDOWN_HERE_EVENT = 'markdown-here-event';

function fireMouseClick(elem) {
  var clickEvent = elem.ownerDocument.createEvent('MouseEvent');
  clickEvent.initMouseEvent(
    'click',
    true,                           // bubbles
    true,                           // cancelable
    elem.ownerDocument.defaultView, // view,
    1,                              // detail,
    0,                              // screenX
    0,                              // screenY
    0,                              // clientX
    0,                              // clientY
    false,                          // ctrlKey
    false,                          // altKey
    false,                          // shiftKey
    false,                          // metaKey
    0,                              // button
    null);                          // relatedTarget

  clickEvent[MARKDOWN_HERE_EVENT] = true;

  elem.dispatchEvent(clickEvent);
}


// Expose these functions
var Utils = {};
Utils.saferSetInnerHTML = saferSetInnerHTML;
Utils.saferSetOuterHTML = saferSetOuterHTML;
Utils.sanitizeDocumentFragment = sanitizeDocumentFragment;
Utils.getLocalURL = getLocalURL;
Utils.getLocalFile = getLocalFile;
Utils.getLocalFileAsBase64 = getLocalFileAsBase64;
Utils.fireMouseClick = fireMouseClick;
Utils.MARKDOWN_HERE_EVENT = MARKDOWN_HERE_EVENT;

var EXPORTED_SYMBOLS = ['Utils'];

if (typeof module !== 'undefined') {
  module.exports = Utils;
} else {
  this.Utils = Utils;
  this.EXPORTED_SYMBOLS = EXPORTED_SYMBOLS;
}

}).call(function() {
  return this || (typeof window !== 'undefined' ? window : global);
}());
