/*
 * Copyright Adam Pritchard 2012
 * MIT License : http://adampritchard.mit-license.org/
 */

/* 
 * Main script file for the options page.
 */

var cssEdit, cssSyntaxEdit, cssSyntaxSelect, rawMarkdownIframe, savedMsg, defaultCss = '';

function onLoad() {
  // Set up our control references.
  cssEdit = document.getElementById('css-edit');
  cssSyntaxEdit = document.getElementById('css-syntax-edit');
  cssSyntaxSelect = document.getElementById('css-syntax-select');
  rawMarkdownIframe = document.getElementById('rendered-markdown');
  savedMsg = document.getElementById('saved-msg');

  //
  // Syntax highlighting styles and selection
  //

  // Get the available highlight.js styles.
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '../common/highlightjs/styles/styles.json', false);
  // synchronous
  xhr.send(); 
  // Assume 200 OK
  var syntaxStyles = JSON.parse(xhr.responseText);
  for (var name in syntaxStyles) {
    cssSyntaxSelect.options.add(new Option(name, syntaxStyles[name]));
  }

  cssSyntaxSelect.options.add(new Option('Currently in use', ''));
  cssSyntaxSelect.selectedIndex = cssSyntaxSelect.options.length - 1;

  cssSyntaxSelect.addEventListener('change', cssSyntaxSelectChange);

  // Load sameple Markdown from a hidden element.
  rawMarkdownIframe.contentDocument.body.contentEditable = true;
  rawMarkdownIframe.contentDocument.body.innerHTML = document.getElementById('sample-markdown').innerHTML;

  //
  // Restore previously set options (asynchronously)
  //

  OptionsStore.get(function(prefs) {
    var markdownHereCss, markdownHereSyntaxCss;

    markdownHereCss = prefs['markdown-here-css'];
    markdownHereSyntaxCss = prefs['markdown-here-syntax-css'];

    var xhr = new XMLHttpRequest();
    xhr.overrideMimeType('text/plain');

    // Get the default value.
    xhr.open('GET', '../common/default.css', false);
    // synchronous
    xhr.send(); 
    // Assume 200 OK
    defaultCss = xhr.responseText;

    if (!markdownHereCss) {
      markdownHereCss = defaultCss;
    }

    if (!markdownHereSyntaxCss) {
      // Get the default value.        
      xhr.open('GET', '../common/highlightjs/styles/github.css', false);
      // synchronous
      xhr.send(); 
      // Assume 200 OK
      markdownHereSyntaxCss = xhr.responseText;
    }

    cssEdit.value = markdownHereCss;

    cssSyntaxEdit.value = markdownHereSyntaxCss;

    // Render the sample Markdown
    renderMarkdown();

    // Start watching for changes to the styles.
    setInterval(checkChange, 100);
  });

  // Load the changelist section
  
  loadChangelist();

  if (location.hash === '#changelist') {
    var cc = document.querySelector('#changelist-container');
    cc.parentElement.insertBefore(cc, document.querySelector('#options-container'));
    setTimeout(function(){scroll(0, 0)}, 1);
  }
}
document.addEventListener('DOMContentLoaded', onLoad, false);

// If the CSS changes and the Markdown compose box is rendered, update the 
// rendering by toggling twice. If the compose box is not rendered, do nothing.
// Groups changes together rather than on every keystroke.
var lastCSS = '';
var lastChangeTime = null;
var firstSave = true;
function checkChange() {
  var newCSS = cssEdit.value + cssSyntaxEdit.value;

  if (newCSS !== lastCSS) {
    // CSS has changed.
    lastCSS = newCSS;
    lastChangeTime = new Date();    
  }
  else {
    // No change since the last check.
    // There's a delicate balance to choosing this apply/save-change timeout value.
    // We want the user to see the effects of their change quite quickly, but 
    // we don't want to spam our saves (because there are quota limits). But we
    // have to save before we can re-render (the rendering using the saved values).
    if (lastChangeTime && (new Date() - lastChangeTime) > 400) {
      // Sufficient time has passed since the last change -- time to save.
      lastChangeTime = null;

      OptionsStore.set(
        {'markdown-here-css': cssEdit.value, 'markdown-here-syntax-css': cssSyntaxEdit.value},
        function() {
          updateMarkdownRender();

          // Show the "saved changes" message, unless this is the first save 
          // (i.e., the one when the user first opens the options window).
          if (!firstSave) {
            savedMsg.style.webkitTransition = 'opacity 100ms';
            savedMsg.style.opacity = '90';
            // Hide it a bit later.
            setTimeout(function() {
              savedMsg.style.webkitTransition = 'opacity 1000ms';
              savedMsg.style.opacity = '0';
            }, 2000);
          }
          firstSave = false;
        });
    }
  }
}

// Helper for rendering.
function logger() { 
  console.log.apply(console, arguments); 
}

// Helper for rendering.
// This function stolen entirely from contentscript.js
function requestMarkdownConversion(html, callback) {
  // Send a request to the add-on script to actually do the rendering.
  chrome.extension.sendRequest(html, function(response) {
    callback(response.html, response.css);
  });
}

// Render the sample Markdown.
function renderMarkdown(postRenderCallback) {
  if (rawMarkdownIframe.contentDocument.querySelector('.markdown-here-wrapper')) {
    // Already rendered.
    postRenderCallback();
    return;
  }

  // The body of the iframe needs to have a (collapsed) selection range for
  // Markdown Here to work (simulating focus/cursor).
  var range = rawMarkdownIframe.contentDocument.createRange();
  range.setStart(rawMarkdownIframe.contentDocument.body);
  var sel = rawMarkdownIframe.contentDocument.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  // Begin rendering.
  markdownHere(rawMarkdownIframe.contentDocument, requestMarkdownConversionInterceptor, logger);

  // To figure out when the (asynchronous) rendering is complete -- so we
  // can call the `postRenderCallback` -- we'll intercept the callback used
  // by the rendering service.

  function requestMarkdownConversionInterceptor(html, callback) {
    function callbackInterceptor() {
      callback.apply(null, arguments);

      // Rendering done. Call callback.
      if (postRenderCallback) postRenderCallback();
    }

    // Call the real rendering service.
    requestMarkdownConversion(html, callbackInterceptor);
  }
}

// Re-render already-rendered sample Markdown.
function updateMarkdownRender() {
  if (!rawMarkdownIframe.contentDocument.querySelector('.markdown-here-wrapper')) {
    // Not currently rendered, so nothing to update.
    return;
  }

  // To mitigate flickering, hide the iframe during rendering.
  rawMarkdownIframe.style.visibility = 'hidden';

  // Unrender
  markdownHere(rawMarkdownIframe.contentDocument, requestMarkdownConversion, logger);

  // Re-render
  renderMarkdown(function() { 
    rawMarkdownIframe.style.visibility = 'visible'; 
  });
}

// Toggle the render state of the sample Markdown.
function markdownToggle() {
  markdownHere(rawMarkdownIframe.contentDocument, requestMarkdownConversion, logger);
}
document.querySelector('#markdown-toggle-button').addEventListener('click', markdownToggle, false);

// Reset the main CSS to default.
function resetCssEdit() {
  cssEdit.value = defaultCss;
}
document.querySelector('#reset-button').addEventListener('click', resetCssEdit, false);

// The syntax hightlighting CSS combo-box selection changed.
function cssSyntaxSelectChange() {
  var selected = cssSyntaxSelect.options[cssSyntaxSelect.selectedIndex].value;
  if (!selected) {
    // This probably indicates that the user selected the "currently in use"
    // option, which is by definition what is in the edit box.
    return;
  }

  // Remove the "currently in use" option, since it doesn't make sense anymore.
  if (!cssSyntaxSelect.options[cssSyntaxSelect.options.length-1].value) {
    cssSyntaxSelect.options.length -= 1;
  }

  // Get the CSS for the selected theme.
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '../common/highlightjs/styles/'+selected, false);
  // synchronous
  xhr.send(); 
  // Assume 200 OK

  cssSyntaxEdit.value = xhr.responseText;
}

function loadChangelist() {
  var xhr = new XMLHttpRequest();
  xhr.overrideMimeType('text/plain');

  // Get the default value.
  xhr.open('GET', '../CHANGES.md', false);
  // synchronous
  xhr.send(); 
  // Assume 200 OK
  var changes = xhr.responseText;

  var markedOptions = {
        gfm: true,
        pedantic: false,
        sanitize: false };

  changes = marked(changes, markedOptions);

  document.querySelector('#changelist').innerHTML = changes;
}
