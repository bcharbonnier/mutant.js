(function (global) {
  /* Mutant.js */

  function throttle(fn, threshhold, scope) {
    var last, deferTimer;

    return function () {
      var now = Date.now();
      if (last && now < last + threshhold) {
        // hold on to it
        clearTimeout(deferTimer);
        deferTimer = setTimeout(function () {
          last = now;
          fn.apply(scope);
        }, threshhold);
      } else {
        last = now;
        fn.apply(scope);
      }
    };
  }

  function bind(fn, scope) {
    if(fn.bind) return fn.bind(scope);

    return function() {
      var args = Array.prototype.slice.call(arguments);
      fn.apply(scope, args);
    };
  }



  /**
   * A really simple and horrible MutationObserver
   */
  function LegacyMutations(callback) {
    this._callback = callback;
    this._onModifications = throttle(function() {
      this._callback([]);
    }, 5, this);
  }

  LegacyMutations.prototype = {
    observe: function(target) {
      this._target = target;
      // NB this is not a fullblow shim, just enough to get by
      // therefore options are ignored
      target.addEventListener('DOMSubtreeModified', this._onModifications, false);
    },

    disconnect: function() {
      if(!this._target) return;
      this._target.removeEventListener('DOMSubtreeModified', this._onModifications, false);
      delete this._target;
    },

    takeRecords: function() {
      var target = this._target;
      if(!this._target) return;

      target.removeEventListener('DOMSubtreeModified', this._onModifications, false);
      target.addEventListener('DOMSubtreeModified', this._onModifications, false);
    }
  };

  /**
   * An eventhandler implementation
   */
  function EventHandler(element, callback, context) {
    this.element = element;
    this.callback = callback;
    this.context = context;
    element.addEventListener('load', this, false);
    element.addEventListener('error', this, false);
  }

  EventHandler.prototype = {
    _detach: function() {
      if(!this.element) return;

      this.element.removeEventListener('load', this, false);
      this.element.removeEventListener('error', this, false);
      this.element = null;
      this.callback = null;
      this.context = null;
    },

    handleEvent: function(e) {
      this.callback.call(this.context, e, this);
    },
  };

  var document = global.document;
  var MutationObserver = global.MutationObserver || global.MozMutationObserver || global.WebKitMutationObserver || LegacyMutations;

  var idCounter = 0;

  /**
   * Determines whether a node is an element which may change its layout
   */
  function isWatchCandidate(node) {
    var r = node.nodeType === 1 &&
            node.tagName === 'IMG' &&
            !node.complete &&
            (!node.getAttribute('width') || !node.getAttribute('height'));

    return r;
  }

  function datasetGet(element, attribute) {
    if(element.dataset) {
      return element.dataset[attribute];
    }

    return element.getAttribute('data-' + attribute);
  }

  function datasetSet(element, attribute, value) {
    if(element.dataset) {
      element.dataset[attribute] = value;
      return;
    }

    return element.setAttribute('data-' + attribute, value);
  }

  function datasetRemove(element, attribute) {
    if(element.dataset) {
      delete element.dataset[attribute];
      return;
    }

    element.removeAttribute(attrName);
    return;
  }
  /**
   * Mutant
   */
  function Mutant(target, callback, options) {
    this._eventHandlers = {};

    var scope = options && options.scope ? options.scope : null;
    var throttleTimeout = options && options.timeout ? options.timeout : 0;
    var self = this;

    if(throttleTimeout) {
      this._callback = throttle(function() {
        try {
          callback.apply(scope);
        } finally {
          self.takeRecords();
        }
      }, throttleTimeout);
    } else {
      this._callback = function() {
        try {
          callback.apply(scope);
        } finally {
          self.takeRecords();
        }
      };
    }

    /* Find any existing loading images in the target */
    this._findLoadingImages(target);

    this._mutationCallback = bind(this._mutationCallback, this);
    this.observer = new MutationObserver(this._mutationCallback);

    // pass in the target node, as well as the observer options
    var observers = {
      attributes: options && options.observers && options.observers.attributes || false,
      childList: options && options.observers && options.observers.childList ? options.observers.childList : true,
      characterData: options && options.observers && options.observers.characterData || false,
      subtree: options && options.observers && options.observers.subtree ? options.observers.subtree : true
    };

    if (observers.attributes !== false && options && options.observers && options.observers.attributeFilter) {
      observers.attributeFilter = options.observers.attributeFilter;
    }

    if (observers.attributes && options.observers.attributeOldValue) {
      observers.attributeOldValue = options.observers.attributeOldValue;
    }
    if (observers.characterData && options.observers.characterDataOldValue) {
      observers.characterDataOldValue = options.observers.characterDataOldValue;
    }
    this.observer.observe(target, observers);
  }

  Mutant.prototype = {
    _addListener: function(element) {

      if(datasetGet(element, 'gLoadListenerId')) return;

      var id = ++idCounter;
      datasetSet(element, 'gLoadListenerId', id);

      this._eventHandlers[id] = new EventHandler(element, function(e, eventHandler) {
        eventHandler._detach();
        this._callback();
      }, this);

    },

    _removeListener: function(element) {
      var id = datasetGet(element, 'gLoadListenerId');

      if(!id) return;
      datasetRemove(element, 'gLoadListenerId');

      var handler = this._eventHandlers[id];
      if(!handler) return;
      delete this._eventHandlers[id];

      handler._detach();
    },

    _mutationCallback: function(mutationRecords) {
      var s = this;

      mutationRecords.forEach(function(r) {
        var node;

        if(r.type === 'childList') {
          // Iterate nodeLists which don't have a .forEach
          if(r.addedNodes) {
            for(var i = 0; i < r.addedNodes.length; i++) {
              node = r.addedNodes[i];
              if(node.nodeType === 1) {
                if(node.children.length) {
                  s._findLoadingImages(node);
                } else {
                  if(isWatchCandidate(node)) {
                    s._addListener(node);
                  }
                }
              }

            }
          }

          if(r.removedNodes) {
            for(var j = 0; j < r.removedNodes.length; j++) {
              node = r.removedNodes[j];
              if(node.nodeType === 1) {
                if(node.children.length) {
                } else {
                  if(node.tagName === 'IMG') {
                    s._removeListener(node);
                  }
                }

              }

            }
          }
        }
      });

      this._callback();
    },


    _findLoadingImages: function(element) {
      var imgs = element.querySelectorAll('img');
      for(var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if(isWatchCandidate(img)) {
          this._addListener(img);
        }
      }
    },

    takeRecords: function() {
      return this.observer.takeRecords();
    },

    disconnect: function() {
      this.observer.disconnect();
      var eh = this._eventHandlers;

      Object.keys(eh).forEach(function(id) {
        var handler = eh[id];
        if(!handler) return;
        delete eh[id];

        handler._detach();
      });
    }
  };

  global.Mutant = Mutant;

  if (typeof define === 'function' && define.amd) {
    define([], function() {
      return Mutant;
    });
  }

  return Mutant;
})(window);





