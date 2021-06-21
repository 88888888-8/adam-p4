/*
 * Copyright Adam Pritchard 2012
 * MIT License : http://adampritchard.mit-license.org/
 */

/*
 * This file is the heart of Markdown Here. It decides whether we're rendering
 * or revert; whether we're doing a selection or the whole thing; and actually
 * does it (calling out for the final render).
 */

;(function() {

// For debugging purposes. An external service is required to log with Firefox.
var mylog = function() {};

// Used to create unique IDs for each Markdown Here wrapper.
var markdownHereWrapperIdCounter = 1;

// Finds and returns the page element that currently has focus. Drills down into
// iframes if necessary.
function findFocusedElem(document) {
  var focusedElem = document.activeElement;

  // If the focus is within an iframe, we'll have to drill down to get to the
  // actual element.
  while (focusedElem && focusedElem.contentDocument) {
    focusedElem = focusedElem.contentDocument.activeElement;
  }

  return focusedElem;
}

// Returns true if the given element can be properly rendered (i.e., if it's 
// a rich-edit compose element).
function elementCanBeRendered(elem) {
  // See here for more info about what we're checking:
  // http://stackoverflow.com/a/3333679/729729
  return elem.contentEditable === true || elem.contentEditable === 'true'
         || elem.contenteditable === true || elem.contenteditable === 'true'
         || (elem.ownerDocument && elem.ownerDocument.designMode === 'on');  
}

// Get the currectly selected range. If there is no selected range (i.e., it is
// collapsed), then contents of the currently focused element will be selected.
// Returns null if no range is selected nor can be selected.
function getOperationalRange(focusedElem) {
  var selection, range, sig;

  selection = focusedElem.ownerDocument.getSelection();
  if (selection.rangeCount < 1) {
    return null;
  }

  range = selection.getRangeAt(0);

  if (range.collapsed) {
    // If there's no actual selection, select the contents of the focused element.
    range.selectNodeContents(focusedElem);
  }
  
  // Does our range include a signature? If so, remove it.
  sig = findSignatureStart(focusedElem);
  if (sig) {
    if (range.isPointInRange(sig, 0)) {
      range.setEndBefore(sig);
    }
  }

  return range;
}

// A signature is indicated by a `'-- '` text node (or something like it).
// Returns the sig start element, or null if one is not found.
function findSignatureStart(startElem) {
  var i, child, recurseReturn;

  for (i = 0; i < startElem.childNodes.length; i++) {
    child = startElem.childNodes[i];
    if (child.nodeType === child.TEXT_NODE) {
      // Thunderbird wraps the sig in a `<pre>`, so there's a newline.
      // Hand-written sigs (including Hotmail and Yahoo) are `'--&nbsp;'` (aka \u00a0).
      // Gmail auto-inserted sigs are `'-- '` (plain space).
      if (child.nodeValue.search(/^--[\s\u00a0]+(\n|$)/) === 0) {

        // Assume that the entire parent element belongs to the sig only if the
        // `'--'` bit is the at the very start of the parent.
        if (startElem.firstChild === child) {
          return startElem;
        }
        
        return child;
      }
    }
    else {
      recurseReturn = findSignatureStart(child, true);

      // Did the recursive call find it?
      if (recurseReturn) {
        return recurseReturn;
      }
    }
  }

  return null;
}

// Replaces the contents of `range` with the HTML string in `html`.
// Returns the element that is created from `html`.
function replaceRange(range, html) {
  var documentFragment, newElement;

  range.deleteContents();

  // Create a DocumentFragment to insert and populate it with HTML
  documentFragment = range.createContextualFragment(html);

  // After inserting the node contents, the node is empty. So we need to save a
  // reference to the element that we need to return.
  newElement = documentFragment.firstChild;

  range.insertNode(documentFragment);

  // Make sure the replacement is selected. This isn't strictly necessary, but
  // in order to make Chrome and Firefox consistent, we either need to remove
  // the selection in Chrome, or set it in Firefox. We'll do the latter.
  range.selectNode(newElement);

  return newElement;
}

// Returns the stylesheet for our styles.
function getMarkdownStylesheet(elem, css) {
  var styleElem, stylesheet, i;

  // We have to actually create a style element in the document, then pull the
  // stylesheet out of it (and remove the element).

  // Create a style element
  styleElem = elem.ownerDocument.createElement('style');
  styleElem.setAttribute('title', 'markdown-here-styles');

  // Set the CSS in the style element
  styleElem.appendChild(elem.ownerDocument.createTextNode(css));

  // Put the style element in the DOM under `elem`
  elem.appendChild(styleElem);

  // Find the stylesheet that we just created
  for (i = 0; i < elem.ownerDocument.styleSheets.length; i++) {
    if (elem.ownerDocument.styleSheets[i].title === 'markdown-here-styles') {
      stylesheet = elem.ownerDocument.styleSheets[i];
      break;
    }
  }

  if (!stylesheet) {
    throw 'Markdown Here stylesheet not found!';
  }

  // Take the stylesheet element out of the DOM
  elem.removeChild(styleElem);

  return stylesheet;
}

// Applies our styling explicitly to the elements under `elem`.
function makeStylesExplicit(wrapperElem, css) {
  var stylesheet, rule, selectorMatches, i, j;

  // There appears to be an oddity (bug?) in Thunderbird (but not Firefox!?!) 
  // whereby it can't cope with dash-separated style names. So something like 
  // this doesn't work:
  //     element.style['background-color'] = style['background-color'];
  // But this does:
  //     element.style['backgroundColor'] = style['backgroundColor'];
  // The camel-case style seems to work fine in Chrome and Firefox, so we'll use
  // that for all of them.

  // From: http://www.devcurry.com/2011/07/javascript-convert-camelcase-to-dashes.html
  function dashToCamel(str) {return str;
    return str.replace(/\W+(.)/g, function (x, chr) { return chr.toUpperCase(); });
  }

  function applyStyleToElement(style, element) {
    var i = 0, styleName;
    for (i = 0; i < style.length; i++) {
      styleName = dashToCamel(style[i]);
      element.style[styleName] = style[styleName];
    }
  }

  stylesheet = getMarkdownStylesheet(wrapperElem, css);

  for (i = 0; i < stylesheet.cssRules.length; i++) {
    rule = stylesheet.cssRules[i];

    // Special case for the selector: If the selector is '.markdown-here-wrapper',
    // then we want to apply the rules to the wrapper (not just to its ancestors,
    // which is what querySelectorAll gives us).
    // Note that the CSS should not have any rules that use "body" or "html".

    if (rule.selectorText === '.markdown-here-wrapper') {
      applyStyleToElement(rule.style, wrapperElem);
    }
    else {
      selectorMatches = wrapperElem.querySelectorAll(rule.selectorText);
      for (j = 0; j < selectorMatches.length; j++) {
        applyStyleToElement(rule.style, selectorMatches[j]);
      }
    }
  }
}

// Find the wrapper element that's above the current cursor position and returns
// it. Returns falsy if there is no wrapper.
function findMarkdownHereWrapper(focusedElem) {
  var selection, range, wrapper = null, match, i;

  selection = focusedElem.ownerDocument.getSelection();

  if (selection.rangeCount < 1) {
    return null;
  }

  range = selection.getRangeAt(0);

  wrapper = range.commonAncestorContainer;
  while (wrapper) {
    match = false;
    for (i = 0; wrapper.attributes && i < wrapper.attributes.length; i++) {
      if (wrapper.attributes[i].value === 'markdown-here-wrapper') {
        match = true;
        break;
      }
    }

    if (match) break;

    wrapper = wrapper.parentNode;
  }

  return wrapper;
}

// Finds all Markdown Here wrappers in the given range. Returns an array of the
// wrapper elements, or null if no wrappers found.
function findMarkdownHereWrappersInRange(range) {
  var documentFragment, cloneWrappers, wrappers, selection, i;

  // Finding elements in a range isn't very simple...

  documentFragment = range.cloneContents();

  cloneWrappers = documentFragment.querySelectorAll('.markdown-here-wrapper');

  if (cloneWrappers && cloneWrappers.length > 0) {
    // Now we have an array of *copies* of the wrappers in the DOM. Find them in
    // the DOM from their IDs. This is why we need unique IDs for our wrappers.
    wrappers = [];
    for (i = 0; i < cloneWrappers.length; i++) {
      wrappers.push(range.commonAncestorContainer.ownerDocument.getElementById(cloneWrappers[i].id));
    }

    return wrappers;
  }
  else {
    return null;
  }
}

// Converts the Markdown in the user's compose element to HTML and replaces it.
// If `selectedRange` is null, then the entire email is being rendered.
function renderMarkdown(focusedElem, selectedRange, markdownRenderer) {
  var extractedHtml, rangeWrapper;

  // Wrap the selection in a new element so that we can better extract the HTML.
  // This modifies the DOM, but that's okay, since we're going to replace the
  // new element in a moment.
  rangeWrapper = focusedElem.ownerDocument.createElement('div');
  rangeWrapper.appendChild(selectedRange.extractContents());
  selectedRange.insertNode(rangeWrapper);
  selectedRange.selectNode(rangeWrapper);

  // Get the HTML containing the Markdown from the selection.
  extractedHtml = rangeWrapper.innerHTML;

  if (!extractedHtml || extractedHtml.length === 0) {
    return 'No Markdown found to render';
  }

  // Call to the extension main code to actually do the md->html conversion.
  markdownRenderer(extractedHtml, function(mdHtml, mdCss) {
    var wrapper;

    // Wrap our pretty HTML in a <div> wrapper.
    // We'll use the wrapper as a marker to indicate that we're in a rendered state.
    mdHtml =
      '<div class="markdown-here-wrapper" id="markdown-here-wrapper-' + (markdownHereWrapperIdCounter++) + '">' +
      mdHtml +
      '</div>';

    // Store the original Markdown-in-HTML to a data attribute on the wrapper
    // element. We'll use this later if we need to unrender back to Markdown.
    wrapper = replaceRange(selectedRange, mdHtml);
    wrapper.setAttribute('data-md-original', extractedHtml);

    // Some webmail (Gmail) strips off any external style block. So we need to go
    // through our styles, explicitly applying them to matching elements.
    makeStylesExplicit(wrapper, mdCss);
  });
}

// Revert the rendered Markdown wrapperElem back to its original form.
function unrenderMarkdown(wrapperElem) {
  wrapperElem.outerHTML = wrapperElem.getAttribute('data-md-original');
}

// Exported function.
// The context menu handler. Does the rendering or unrendering, depending on the
// state of the email compose element and the current selection.
// @param `document`  The document object containg the email compose element.
//        (Actually, it can be any document above the compose element. We'll
//        drill down to find the correct element and document.)
// @param `markdownRenderer`  The function that provides raw-Markdown-in-HTML
//                            to pretty-Markdown-in-HTML rendering service.
//                            See markdown-render.js for information.
// @param `logger`  A function that can be used for logging debug messages. May
//                  be null.
// @returns True if successful, otherwise an error message that should be shown
//          to the user.
function markdownHere(document, markdownRenderer, logger) {

  if (logger) {
    mylog = logger;
  }

  // If the cursor (or current selection) is in a Markdown Here wrapper, then
  // we're reverting that wrapper back to Markdown. If there's a selection that
  // contains one or more wrappers, then we're reverting those wrappers back to
  // Markdown.
  // Otherwise, we're rendering. If there's a selection, then we're rendering
  // the selection. If not, then we're rendering the whole email.

  var wrappers, outerWrapper, focusedElem, range, i;

  focusedElem = findFocusedElem(document);
  if (!focusedElem || !focusedElem.ownerDocument) {
    return 'Could not find focused element';
  }

  // Look for existing rendered-Markdown wrapper to revert.
  outerWrapper = findMarkdownHereWrapper(focusedElem);
  if (outerWrapper) {
    // There's a wrapper above us.
    wrappers = [outerWrapper];
  }
  else {
    // Are there wrappers in our selection?

    range = getOperationalRange(focusedElem);

    if (!range) {
      return 'Nothing found to render or revert'
    }

    // Look for wrappers in the range under consideration.
    wrappers = findMarkdownHereWrappersInRange(range);
  }

  // If we've found wrappers, then we're reverting.
  // Otherwise, we're rendering.
  if (wrappers && wrappers.length > 0) {
    for (i = 0; i < wrappers.length; i++) {
      unrenderMarkdown(wrappers[i]);
    }
  }
  else {
    renderMarkdown(focusedElem, range, markdownRenderer);
  }

  return true;
}

// We also export a couple of utility functions
markdownHere.findFocusedElem = findFocusedElem;
markdownHere.elementCanBeRendered = elementCanBeRendered;

var EXPORTED_SYMBOLS = ['markdownHere'];

if (typeof module !== 'undefined') {
  module.exports = markdownHere;
} else {
  this.markdownHere = markdownHere;
  this.EXPORTED_SYMBOLS = EXPORTED_SYMBOLS;
}

}).call(function() {
  return this || (typeof window !== 'undefined' ? window : global);
}());
