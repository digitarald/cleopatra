var kMaxChunkDuration = 30; // ms

var escape = document.createElement('textarea');

function assert(condition) {
  if (!condition) {
    console.log("assertion failed");
  }
}

function escapeHTML(html) {
  escape.innerHTML = html;
  return escape.innerHTML;
}

function unescapeHTML(html) {
  escape.innerHTML = html;
  return escape.value;
}

RegExp.escape = function(text) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

var requestAnimationFrame = window.webkitRequestAnimationFrame ||
                            window.mozRequestAnimationFrame ||
                            window.oRequestAnimationFrame ||
                            window.msRequestAnimationFrame ||
                            function(callback, element) {
                              return window.setTimeout(callback, 1000 / 60);
                            };

var cancelAnimationFrame = window.webkitCancelAnimationFrame ||
                           window.mozCancelAnimationFrame ||
                           window.oCancelAnimationFrame ||
                           window.msCancelAnimationFrame ||
                           function(req) {
                             window.clearTimeout(req);
                           };

function TreeView() {
  this._eventListeners = {};

  this._container = document.createElement("div");
  this._container.className = "treeViewContainer";
  this._container.setAttribute("tabindex", "0"); // make it focusable

  this._header = document.createElement("ul");
  this._header.className = "treeHeader";
  this._container.appendChild(this._header);

  this._treeOuterContainer = document.createElement("div");
  this._treeOuterContainer.className = "treeViewTreeOuterContainer";
  this._container.appendChild(this._treeOuterContainer);

  this._treeInnerContainer = document.createElement("div");
  this._treeInnerContainer.className = "treeViewTreeInnerContainer";
  this._treeOuterContainer.appendChild(this._treeInnerContainer);

  this._styleElement = document.createElement("style");
  this._styleElement.setAttribute("type", "text/css");
  this._container.appendChild(this._styleElement);

  this._contextMenu = document.createElement("menu");
  this._contextMenu.setAttribute("type", "context");
  this._contextMenu.id = "contextMenuForTreeView" + TreeView.instanceCounter++;
  this._container.appendChild(this._contextMenu);

  this._busyCover = document.createElement("div");
  this._busyCover.className = "busyCover";
  this._container.appendChild(this._busyCover);
  this.initSelection = true;

  this._rowHeight = 16;
  this._treeNodes = null;
  this._treeRows = [];
  this._callback = null;
  this._displayedStuffIsInvalid = false;

  this._scheduledRepaint = null;

  var self = this;
  this._container.onkeydown = function (e) {
    self._onkeypress(e);
  };
  this._container.onkeypress = function (e) {
    // on key down gives us '8' and mapping shift+8='*' may not be portable.
    if (String.fromCharCode(e.charCode) == '*')
      self._onkeypress(e);
  };
  this._container.onclick = function (e) {
    self._onclick(e);
  };
  this._treeOuterContainer.addEventListener("contextmenu", function(event) {
    self._populateContextMenu(event);
  }, true);
  this._treeOuterContainer.addEventListener("scroll", function () {
    self._scheduleRepaint();
  })
};
TreeView.instanceCounter = 0;

TreeView.prototype = {
  getContainer: function TreeView_getContainer() {
    return this._container;
  },
  setColumns: function TreeView_setColumns(columns) {
    this._header.innerHTML = "";
    for (var i = 0; i < columns.length; i++) {
      var li = document.createElement("li");
      li.className = "treeColumnHeader treeColumnHeader" + i;
      li.id = columns[i].name + "Header";
      li.textContent = columns[i].title;
      this._header.appendChild(li);
    }
  },
  getTreeHeader: function TreeView_getTreeHeader() {
    return this._header;
  },
  dataIsOutdated: function TreeView_dataIsOutdated() {
    this._busyCover.classList.add("busy");
  },
  display: function TreeView_display(data, resources, filterByName) {
    this._busyCover.classList.remove("busy");
    this._resources = resources;
    this._addResourceIconStyles();
    this._filterByNameReg = filterByName ? new RegExp("(" + RegExp.escape(filterByName) + ")","gi") : null;
    this._treeInnerContainer.innerHTML = "";
    this._cachedRowRange = { start: 0, end: 0 };
    this._initWithTreeAndCallback(data.nodeTree, data.getDataForNode);
    AppUI.changeFocus(this._container);
  },
  // Provide a snapshot of the reverse selection to restore with 'invert callback'
  getReverseSelectionSnapshot: function TreeView__getReverseSelectionSnapshot(isJavascriptOnly) {
    if (!this._selectedRow)
      return;
    var snapshot = [];
    var curr = this._selectedRow.data;

    while(curr) {
      if (isJavascriptOnly && curr.isJSFrame || !isJavascriptOnly) {
        snapshot.push(curr.name);
        //dump(JSON.stringify(curr.name) + "\n");
      }
      if (curr.children && curr.children.length >= 1) {
        curr = curr.children[0].getData();
      } else {
        break;
      }
    }

    return snapshot.reverse();
  },
  // Provide a snapshot of the current selection to restore
  getSelectionSnapshot: function TreeView__getSelectionSnapshot(isJavascriptOnly) {
    var snapshot = [];
    var curr = this._selectedRow;

    while(curr) {
      if (isJavascriptOnly && curr.data.isJSFrame || !isJavascriptOnly) {
        snapshot.push(curr.data.name);
        //dump(JSON.stringify(curr.data.name) + "\n");
      }
      curr = curr.treeParent;
    }

    return snapshot.reverse();
  },
  setSelection: function TreeView_setSelection(frames, inverted) {
    this.restoreSelectionSnapshot( inverted ? frames.clone().reverse() : frames, false);
  },
  // Take a selection snapshot and restore the selection
  restoreSelectionSnapshot: function TreeView_restoreSelectionSnapshot(snapshot, allowNonContigious) {
    //console.log("restore selection: " + JSON.stringify(snapshot));
    var currNode = this._treeRows[0];
    if (currNode.data.name == snapshot[0] || snapshot[0] == "(total)") {
      snapshot.shift();
    }
    //dump("len: " + snapshot.length + "\n");
    next_level: while (currNode && snapshot.length > 0) {
      this._toggle(currNode, false, true);
      for (var i = 0; i < currNode.visibleChildren.length; i++) {
        if (currNode.visibleChildren[i].data.name == snapshot[0]) {
          //console.log("Found: " + currNode.visibleChildren[i].data.name + "\n");
          snapshot.shift();
          this._toggle(currNode, false, true);
          currNode = currNode.visibleChildren[i];
          continue next_level;
        }
      }
      if (allowNonContigious === true) {
        // We need to do a Breadth-first search to find a match
        var pendingSearch = [currNode.data];
        while (pendingSearch.length > 0) {
          var node = pendingSearch.shift();
          //console.log("searching: " + node.name + " for: " + snapshot[0] + "\n");
          if (!node.visibleChildren)
            continue;
          for (var i = 0; i < node.visibleChildren.length; i++) {
            var childNode = node.visibleChildren[i].getData();
            if (childNode.name == snapshot[0]) {
              //dump("found: " + childNode.name + "\n");
              snapshot.shift();
              var nodesToToggle = [childNode];
              while (nodesToToggle[0].name != currNode.data.name) {
                nodesToToggle.splice(0, 0, nodesToToggle[0].parent);
              }
              var lastToggle = currNode;
              for (var j = 0; j < nodesToToggle.length; j++) {
                for (var k = 0; k < lastToggle.visibleChildren.length; k++) {
                  if (lastToggle.visibleChildren[k].data.name == nodesToToggle[j].name) {
                    //dump("Expend: " + nodesToToggle[j].name + "\n");
                    this._toggle(lastToggle.visibleChildren[k], false, true);
                    lastToggle = lastToggle.visibleChildren[k];
                  }
                }
              }
              currNode = lastToggle;
              continue next_level;
            }
            //dump("pending: " + childNode.name + "\n");
            pendingSearch.push(childNode);
          }
        }
      }
      break; // Didn't find child node matching
    }

    if (currNode == this._treeInnerContainer) {
      PROFILERERROR("Failed to restore selection, could not find root.\n");
      return;
    }

    this._toggle(currNode.rowObject, true, true);
    this._select(currNode);
  },
  addEventListener: function TreeView_addEventListener(eventName, callbackFunction) {
    if (!(eventName in this._eventListeners))
      this._eventListeners[eventName] = [];
    if (this._eventListeners[eventName].indexOf(callbackFunction) != -1)
      return;
    this._eventListeners[eventName].push(callbackFunction);
  },
  removeEventListener: function TreeView_removeEventListener(eventName, callbackFunction) {
    if (!(eventName in this._eventListeners))
      return;
    var index = this._eventListeners[eventName].indexOf(callbackFunction);
    if (index == -1)
      return;
    this._eventListeners[eventName].splice(index, 1);
  },
  _fireEvent: function TreeView__fireEvent(eventName, eventObject) {
    if (!(eventName in this._eventListeners))
      return;
    this._eventListeners[eventName].forEach(function (callbackFunction) {
      callbackFunction(eventObject);
    });
  },
  _initWithTreeAndCallback: function TreeView__initWithTreeAndCallback(tree, callback) {
    var rootRowObject = {
      parent: null,
      depth: 0,
      treeNode: tree,
      data: null,
      collapsed: true,
      selected: true,
      isLeaf: tree.children.length == 0,
      visibleChildren: [],
      numVisibleDescendants: 0
    }
    this._callback = callback;
    this._treeNodes = rootRowObject;
    this._treeRows = [rootRowObject];
    this._scheduleRepaint();
  },
  _calculateRowIndex: function (rowObject) {
    var parent = rowObject.parent;
    if (!parent)
      return 0;
    var parentRowIndex = this._calculateRowIndex(parent);
    var numPrecedingChildrenRows = 0;
    var numVisibleChildren = parent.visibleChildren.length;
    for (var i = 0; i < numVisibleChildren; i++) {
      var currentChild = parent.visibleChildren[i];
      if (rowObject == currentChild) {
        return parentRowIndex + 1 + numPrecedingChildrenRows;
      }
      numPrecedingChildrenRows += 1 + currentChild.numVisibleDescendants;
    }
    throw new Error("row not found in visible rows of parent, _calculateRowIndex must not be called for invisible rows");
  },
  _ensureChildrenOnRowObject: function (rowObject) {
    if (!("children" in rowObject)) {
      rowObject.children = [];
      for (var i = 0; i < rowObject.treeNode.children.length; i++) {
        var child = rowObject.treeNode.children[i];
        rowObject.children[i] = {
          parent: rowObject,
          depth: rowObject.depth + 1,
          treeNode: child,
          data: null,
          collapsed: true,
          selected: false,
          isLeaf: child.children.length == 0,
          visibleChildren: [],
          numVisibleDescendants: 0
        };
      }
    }
    if (rowObject.data !== null)
      delete rowObject.treeNode;
    return rowObject.children;
  },
  _ensureDataOnRowObject: function (rowObject) {
    if (rowObject.data === null) {
      rowObject.data = this._callback(rowObject.treeNode);
    }
    if ("children" in rowObject)
      delete rowObject.treeNode;
    return rowObject.data;
  },
  _propagateNumVisibleDescendantChangeAlongAncestorChain: function (rowObject, delta) {
    while (rowObject !== null) {
      rowObject.numVisibleDescendants += delta;
      rowObject = rowObject.parent;
    }
  },
  _uncollapse: function TreeView__uncollapse(rowObject, rowIndex) {
    if (!rowObject.collapsed)
      return;
    if (rowIndex === undefined)
      rowIndex = this._calculateRowIndex(rowObject);
    var children = this._ensureChildrenOnRowObject(rowObject);
    var numVisibleDescendants = 0;
    var oldNumRows = this._treeRows.length;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      this._insertRowsForElementAndDescendants(child, /* atIndex = */ rowIndex + 1 + numVisibleDescendants);
      numVisibleDescendants += 1 + child.numVisibleDescendants;
      assert(this._treeRows.length == oldNumRows + numVisibleDescendants);
    }
    this._propagateNumVisibleDescendantChangeAlongAncestorChain(rowObject, numVisibleDescendants);
    rowObject.collapsed = false;
    rowObject.visibleChildren = rowObject.children;
  },
  _insertRowsForElementAndDescendants: function (rowObject, atIndex) {
    this._treeRows.splice(atIndex, 0, rowObject);
    var numInsertedDescendants = 0;
    for (var i = 0; i < rowObject.visibleChildren.length; i++) {
      var child = rowObject.visibleChildren[i];
      this._insertRowsForElementAndDescendants(child, atIndex + 1 + numInsertedDescendants);
      numInsertedDescendants += child.numVisibleDescendants;
    }
  },
  _collapse: function TreeView__collapse(rowObject, rowIndex) {
    if (rowObject.collapsed)
      return;
    if (rowIndex === undefined)
      rowIndex = this._calculateRowIndex(rowObject);
    var numRemovedRows = 0;
    for (var i = 0; i < rowObject.visibleChildren.length; i++) {
      var child = rowObject.visibleChildren[i];
      this._removeRowsForElementAndDescendants(child, rowIndex + 1);
      numRemovedRows += 1 + child.numVisibleDescendants;
    }
    assert(numRemovedRows == rowObject.numVisibleDescendants);
    this._propagateNumVisibleDescendantChangeAlongAncestorChain(rowObject, -rowObject.numVisibleDescendants);
    rowObject.collapsed = true;
    rowObject.visibleChildren = [];
  },
  _removeRowsForElementAndDescendants: function (rowObject, atIndex) {
    this._treeRows.splice(atIndex, 1 + rowObject.numVisibleDescendants);
  },
  _scrollRowIntoView: function (rowObject) {
    // We might not have a DOM node for rowObject yet, so we can't measure its
    // bounding client rect.
    var rowIndex = this._calculateRowIndex(this._needToScrollIntoView);
    this._scrollRangeIntoView({
      top: rowIndex * this._rowHeight,
      bottom: (rowIndex + 1) * this._rowHeight
    });
  },
  _repaint: function () {
    this._scheduledRepaint = null;

    if (this._needToScrollIntoView) {
      var rowIndex = this._calculateRowIndex(this._needToScrollIntoView);
      this._scrollRowIntoView(this._needToScrollIntoView);
    }

    var r = this._treeOuterContainer.getBoundingClientRect();
    var x = this._treeOuterContainer.scrollLeft;
    var y = this._treeOuterContainer.scrollTop;
    this._prepareContentInRect(x, y, r.width, r.height);
  },
  _scheduleRepaint: function () {
    if (this._scheduledRepaint === null) {
      this._scheduledRepaint = window.requestAnimationFrame(() => this._repaint());
    }
  },
  _prepareContentInRect: function TreeView__prepareContentInRect(x, y, width, height) {
    var numRowsPerTile = 16; // make rows in tile increments
    var startRow = Math.floor((y - height / 2) / this._rowHeight);
    startRow = Math.floor(startRow / numRowsPerTile) * numRowsPerTile;
    var numRows = Math.ceil(height * 2 / this._rowHeight / numRowsPerTile) * numRowsPerTile;
    this._prepareRows(startRow, startRow + numRows);
  },
  _prepareRows: function TreeView__prepareRows(startRow, endRow) {
    var numRows = this._treeRows.length;
    startRow = Math.max(startRow, 0);
    endRow = Math.min(endRow, numRows);

    var numRowsAboveRenderedRange = startRow;
    var numRowsBelowRenderedRange = numRows - endRow;
    this._treeInnerContainer.style.height = numRows * this._rowHeight + "px";
    this._treeInnerContainer.style.width = "10000px";

    var existingRows = this._treeInnerContainer.childNodes;
    var newNeededRows = {};
    var existingRowsToKeep = {};
    var existingRowsToDiscard = {};
    for (var i = 0; i < existingRows.length; i++) {
      var row = existingRows[i];
      var rowIndex = row.rowIndex;
      if (rowIndex >= startRow && rowIndex < endRow) {
        existingRowsToKeep[rowIndex] = row;
        if (this._displayedStuffIsInvalid) {
          this._updateTreeViewNodeContents(row, this._treeRows[rowIndex], rowIndex);
        }
        if (row.rowObject == this._needToScrollIntoView) {
          this._scrollIntoView(row.querySelector(".functionName"), 400);
        }
      } else {
        existingRowsToDiscard[rowIndex] = row;
      }
    }
    existingRows = null;

    var rowIndicesOfRecyclableRows = Object.keys(existingRowsToDiscard);
    var rowIndicesOfExistingRowsToKeep = Object.keys(existingRowsToKeep);
    rowIndicesOfRecyclableRows.sort(function (a, b) { return a - b; });
    rowIndicesOfExistingRowsToKeep.sort(function (a, b) { return a - b; });
    var rowIndexOfFirstRowToKeep = rowIndicesOfExistingRowsToKeep.length > 0 ? rowIndicesOfExistingRowsToKeep[0] : -1;
    var newRowIndices = [];
    for (var rowIndexOfNewRow = startRow; rowIndexOfNewRow < endRow; rowIndexOfNewRow++) {
      if (rowIndexOfNewRow in existingRowsToKeep)
        continue;
      newRowIndices.push(rowIndexOfNewRow);
      var rowElem;
      if (rowIndicesOfRecyclableRows.length > 0) {
        var existingRowIndex = rowIndicesOfRecyclableRows.pop();
        rowElem = existingRowsToDiscard[existingRowIndex];
        delete existingRowsToDiscard[existingRowIndex];
      } else {
        rowElem = this._createEmptyTreeNodeElement();
      }
      this._updateTreeViewNodeContents(rowElem, this._treeRows[rowIndexOfNewRow], rowIndexOfNewRow);
      if (rowElem.rowObject == this._needToScrollIntoView) {
        this._scrollIntoView(rowElem.querySelector(".functionName"), 400);
      }
      rowElem.style.top = this._rowHeight * rowIndexOfNewRow + "px";
      if (!rowElem.parentNode) {
        this._treeInnerContainer.appendChild(rowElem);
      }
    }

    for (var rowIndexOfRowToDiscard in existingRowsToDiscard) {
      this._treeInnerContainer.removeChild(existingRowsToDiscard[rowIndexOfRowToDiscard]);
    }

    this._cachedRowRange = { start: startRow, end: endRow };
    this._displayedStuffIsInvalid = false;
    this._needToScrollIntoView = false;
  },
  _invalidateEverything: function () {
    this._displayedStuffIsInvalid = true;
    this._scheduleRepaint();
  },
  _createEmptyTreeNodeElement: function TreeView__createEmptyTreeNodeElement() {
    var div = document.createElement("div");
    div.className = "treeViewNode";
    div.innerHTML = this._treeViewNodeEmptyInnerHTML();
    div.style.height = this._rowHeight + "px";
    return div;
  },
  _addResourceIconStyles: function TreeView__addResourceIconStyles() {
    var styles = [];
    for (var resourceName in this._resources) {
      var resource = this._resources[resourceName];
      if (resource.icon) {
        styles.push('.resourceIcon[data-resource="' + resourceName + '"] { background-image: url("' + resource.icon + '"); }');
      }
    }
    this._styleElement.textContent = styles.join("\n");
  },
  _populateContextMenu: function TreeView__populateContextMenu(event) {
    this._treeOuterContainer.setAttribute("contextmenu", "");

    var target = event.target;
    if (target.classList.contains("expandCollapseButton") ||
        target.classList.contains("focusCallstackButton"))
      return;

    var li = this._getParentTreeViewNode(target);
    if (!li)
      return;

    this._select(li);

    this._contextMenu.innerHTML = "";

    var self = this;
    this._contextMenuForFunction(li.data).forEach(function (menuItem) {
      var menuItemNode = document.createElement("menuitem");
      menuItemNode.onclick = (function (menuItem) {
        return function() {
          self._contextMenuClick(li.data, menuItem);
        };
      })(menuItem);
      menuItemNode.label = menuItem;
      self._contextMenu.appendChild(menuItemNode);
    });

    this._treeOuterContainer.setAttribute("contextmenu", this._contextMenu.id);
  },
  _contextMenuClick: function TreeView__contextMenuClick(node, menuItem) {
    this._fireEvent("contextMenuClick", { node: node, menuItem: menuItem });
  },
  _contextMenuForFunction: function TreeView__contextMenuForFunction(node) {
    // TODO move me outside tree.js
    var menu = [];
    if (node.library && (
      node.library.toLowerCase() == "lib_xul" ||
      node.library.toLowerCase() == "lib_mozjs" ||
      node.library.toLowerCase() == "lib_mozjs.pdb" ||
      node.library.toLowerCase() == "lib_mozjs.dll" ||
      node.library.toLowerCase() == "lib_xul.pdb" ||
      node.library.toLowerCase() == "lib_xul.dll"
      )) {
      menu.push("View Source");
    }
    if (node.isJSFrame && node.scriptLocation) {
      menu.push("View JS Source");
    }
    menu.push("Focus Frame");
    menu.push("Focus Callstack");
    menu.push("Google Search");
    menu.push("Plugin View: Pie");
    menu.push("Plugin View: Tree");
    return menu;
  },
  _treeViewNodeEmptyInnerHTML: function () {
    return '' +
      '<span class="rowLabel">' +
      '  <span class="sampleCount"></span> ' +
      '  <span class="samplePercentage"></span> ' +
      '  <span class="selfSampleCount"></span> ' +
      '  <span class="resourceIcon" data-resource=""></span> ' +
      '</span>' +
      '<span title="Expand / Collapse" class="expandCollapseButton"></span>' +
      '<span class="functionName"></span>' +
      '<span class="libraryName"></span>' +
      '<span title="Focus Callstack" title="Focus Callstack" class="focusCallstackButton">';
  },
  _updateTreeViewNodeContents: function (elem, treeRowObject, rowIndex) {
    var data = this._ensureDataOnRowObject(treeRowObject);
    elem.classList.toggle("collapsed", treeRowObject.collapsed);
    elem.classList.toggle("selected", treeRowObject.selected);
    elem.classList.toggle("leaf", treeRowObject.isLeaf);
    if (elem.rowIndex % 2 != rowIndex % 2) {
      elem.classList.toggle("even", rowIndex % 2 == 0);
      elem.classList.toggle("odd", rowIndex % 2 == 1);
    }
    if (elem.rowObject != treeRowObject) {
      var nodeName = escapeHTML(data.name);
      var resource = this._resources[data.library] || {};
      var libName = escapeHTML(resource.name || "");
      if (this._filterByNameReg) {
        nodeName = nodeName.replace(this._filterByNameReg, "<a style='color:red;'>$1</a>");
        libName = libName.replace(this._filterByNameReg, "<a style='color:red;'>$1</a>");
      }
      var samplePercentage = isNaN(data.ratio) ? "" : (100 * data.ratio).toFixed(1) + "%";
      elem.getElementsByClassName("sampleCount")[0].textContent = data.counter;
      elem.getElementsByClassName("samplePercentage")[0].textContent = samplePercentage;
      elem.getElementsByClassName("selfSampleCount")[0].textContent = data.selfCounter;
      elem.getElementsByClassName("resourceIcon")[0].setAttribute("data-resource", data.library);
      elem.getElementsByClassName("expandCollapseButton")[0].style.marginLeft = (treeRowObject.depth + 1) + "em";
      elem.getElementsByClassName("functionName")[0].innerHTML = nodeName;
      elem.getElementsByClassName("libraryName")[0].innerHTML = libName;
    }
    elem.rowObject = treeRowObject;
    elem.rowIndex = rowIndex;
  },
  _toggle: function TreeView__toggle(rowObject, /* optional */ newCollapsedValue) {
    var currentCollapsedValue = rowObject.collapsed;
    if (newCollapsedValue === undefined)
      newCollapsedValue = !currentCollapsedValue;
    if (newCollapsedValue) {
      this._collapse(rowObject);
    } else {
      this._uncollapse(rowObject);
    }
    this._invalidateEverything();
  },
  _toggleAll: function TreeView__toggleAll(subtreeRoot, /* optional */ newCollapsedValue) {
    // Expands / collapses all child nodes, too.
    if (newCollapsedValue === undefined)
      newCollapsedValue = !subtreeRoot.collapsed;
    this._toggle(subtreeRoot, newCollapsedValue);
    for (var i = 0; i < subtreeRoot.visibleChildren.length; ++i) {
      this._toggleAll(subtreeRoot.visibleChildren[i], newCollapsedValue);
    }
  },
  _getParent: function TreeView__getParent(div) {
    return div.treeParent;
  },
  _getFirstChild: function TreeView__getFirstChild(div) {
    if (this._isCollapsed(div))
      return null;
    var child = div.treeChildren[0];
    return child;
  },
  _getLastChild: function TreeView__getLastChild(div) {
    if (this._isCollapsed(div))
      return div;
    var lastChild = div.treeChildren[div.treeChildren.length-1];
    if (lastChild == null)
      return div;
    return this._getLastChild(lastChild);
  },
  _getPrevSib: function TreeView__getPevSib(div) {
    if (div.treeParent == null)
      return null;
    var nodeIndex = div.treeParent.treeChildren.indexOf(div);
    if (nodeIndex == 0)
      return null;
    return div.treeParent.treeChildren[nodeIndex-1];
  },
  _getNextSib: function TreeView__getNextSib(div) {
    if (div.treeParent == null)
      return null;
    var nodeIndex = div.treeParent.treeChildren.indexOf(div);
    if (nodeIndex == div.treeParent.treeChildren.length - 1)
      return this._getNextSib(div.treeParent);
    return div.treeParent.treeChildren[nodeIndex+1];
  },
  _scheduleScrollIntoView: function TreeView__scheduleScrollIntoView(element, maxImportantWidth) {
    // Schedule this on the animation frame otherwise we may run this more then once per frames
    // causing more work then needed.
    var self = this;
    if (self._pendingAnimationFrame != null) {
      return;
    }
    self._pendingAnimationFrame = requestAnimationFrame(function anim_frame() {
      cancelAnimationFrame(self._pendingAnimationFrame);
      self._pendingAnimationFrame = null;
      self._scrollIntoView(element, maxImportantWidth);
    });
  },
  _scrollIntoView: function TreeView__scrollIntoView(element, maxImportantWidth) {
    // Make sure that element is inside the visible part of our scrollbox by
    // adjusting the scroll positions. If element is wider or
    // higher than the scroll port, the left and top edges are prioritized over
    // the right and bottom edges.
    // If maxImportantWidth is set, parts of the beyond this widths are
    // considered as not important; they'll not be moved into view.

    if (maxImportantWidth === undefined)
      maxImportantWidth = Infinity;

    var r = element.getBoundingClientRect();

    this._scrollRangeIntoView({
      left: r.left,
      right: Math.min(r.right, r.left + maxImportantWidth),
      top: r.top,
      bottom: r.bottom
    });
  },
  _scrollRangeIntoView: function TreeView__scrollIntoView(range) {
    // range has left + right and/or top + bottom properties
    // Make sure that the specified range is inside the visible part of our
    // scrollbox by adjusting the scroll positions. If element is wider or
    // higher than the scroll port, the left and top edges are prioritized over
    // the right and bottom edges.
    var visibleRect = {
      left: this._treeInnerContainer.getBoundingClientRect().left + 150, // TODO: un-hardcode 150
      top: this._treeOuterContainer.getBoundingClientRect().top,
      right: this._treeInnerContainer.getBoundingClientRect().right,
      bottom: this._treeOuterContainer.getBoundingClientRect().bottom
    }
    if ("left" in range) {
      var leftCutoff = visibleRect.left - range.left;
      var rightCutoff = range.right - visibleRect.right;
      if (leftCutoff > 0)
        this._treeInnerContainer.scrollLeft -= leftCutoff;
      else if (rightCutoff > 0)
        this._treeInnerContainer.scrollLeft += Math.min(rightCutoff, -leftCutoff);
    }
    if ("top" in range) {
      var topCutoff = visibleRect.top - range.top;
      var bottomCutoff = range.bottom - visibleRect.bottom;
      if (topCutoff > 0)
        this._treeOuterContainer.scrollTop -= topCutoff;
      else if (bottomCutoff > 0)
        this._treeOuterContainer.scrollTop += Math.min(bottomCutoff, -topCutoff);
    }
  },
  _select: function TreeView__select(div) {
    if (this._selectedRow != null) {
      this._selectedRow.selected = false;
      this._selectedRow = null;
    }
    if (div) {
      var rowObject = div.rowObject;
      rowObject.selected = true;
      this._selectedRow = rowObject;
      this._needToScrollIntoView = rowObject;
      this._fireEvent("select", this._ensureDataOnRowObject(rowObject));
    }
    this._scheduleRepaint();
    AppUI.updateDocumentURL();
  },
  _isCollapsed: function TreeView__isCollapsed(div) {
    return div.classList.contains("collapsed");
  },
  _getParentTreeViewNode: function TreeView__getParentTreeViewNode(node) {
    while (node) {
      if (node.nodeType != node.ELEMENT_NODE)
        break;
      if (node.classList.contains("treeViewNode"))
        return node;
      node = node.parentNode;
    }
    return null;
  },
  _onclick: function TreeView__onclick(event) {
    var target = event.target;
    var node = this._getParentTreeViewNode(target);
    if (!node)
      return;
    if (target.classList.contains("expandCollapseButton")) {
      if (event.altKey)
        this._toggleAll(node.rowObject);
      else
        this._toggle(node.rowObject);
    } else if (target.classList.contains("focusCallstackButton")) {
      this._fireEvent("focusCallstackButtonClicked", node.data);
    } else {
      this._select(node);
      if (event.detail == 2) // dblclick
        this._toggle(node.rowObject);
    }
  },
  _onkeypress: function TreeView__onkeypress(event) {
    if (event.ctrlKey || event.altKey || event.metaKey)
      return;

    var selected = this._selectedRow;
    if (event.keyCode < 37 || event.keyCode > 40) {
      if (event.keyCode != 0 ||
          String.fromCharCode(event.charCode) != '*') {
        return;
      }
    }
    event.stopPropagation();
    event.preventDefault();
    if (!selected)
      return;
    if (event.keyCode == 37) { // KEY_LEFT
      var isCollapsed = this._isCollapsed(selected);
      if (!isCollapsed) {
        this._toggle(selected.rowObject);
      } else {
        var parent = this._getParent(selected); 
        if (parent != null) {
          this._select(parent);
        }
      }
    } else if (event.keyCode == 38) { // KEY_UP
      var prevSib = this._getPrevSib(selected);
      var parent = this._getParent(selected); 
      if (prevSib != null) {
        this._select(this._getLastChild(prevSib));
      } else if (parent != null) {
        this._select(parent);
      }
    } else if (event.keyCode == 39) { // KEY_RIGHT
      var isCollapsed = this._isCollapsed(selected);
      if (isCollapsed) {
        this._toggle(selected.rowObject);
      } else {
        // Do KEY_DOWN only if the next element is a child
        var child = this._getFirstChild(selected);
        if (child != null) {
          this._select(child);
        }
      }
    } else if (event.keyCode == 40) { // KEY_DOWN
      var nextSib = this._getNextSib(selected);
      var child = this._getFirstChild(selected); 
      if (child != null) {
        this._select(child);
      } else if (nextSib) {
        this._select(nextSib);
      }
    } else if (String.fromCharCode(event.charCode) == '*') {
      this._toggleAll(selected.rowObject);
    }
  },
};

