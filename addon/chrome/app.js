(function () {
	'use strict';

	function Vnode(tag, key, attrs, children, text, dom) {
		return {tag: tag, key: key, attrs: attrs, children: children, text: text, dom: dom, domSize: undefined, state: undefined, events: undefined, instance: undefined}
	}

	Vnode.normalize = function(node) {
		if (Array.isArray(node)) return Vnode("[", undefined, undefined, Vnode.normalizeChildren(node), undefined, undefined)
		if (node == null || typeof node === "boolean") return null
		if (typeof node === "object") return node
		return Vnode("#", undefined, undefined, String(node), undefined, undefined)
	};

	Vnode.normalizeChildren = function(input) {
		var children = [];
		if (input.length) {
			var isKeyed = input[0] != null && input[0].key != null;
			// Note: this is a *very* perf-sensitive check.
			// Fun fact: merging the loop like this is somehow faster than splitting
			// it, noticeably so.
			for (var i = 1; i < input.length; i++) {
				if ((input[i] != null && input[i].key != null) !== isKeyed) {
					throw new TypeError(
						isKeyed && (input[i] != null || typeof input[i] === "boolean")
							? "In fragments, vnodes must either all have keys or none have keys. You may wish to consider using an explicit keyed empty fragment, m.fragment({key: ...}), instead of a hole."
							: "In fragments, vnodes must either all have keys or none have keys."
					)
				}
			}
			for (var i = 0; i < input.length; i++) {
				children[i] = Vnode.normalize(input[i]);
			}
		}
		return children
	};

	function hyperscriptVnode() {
		var attrs = arguments[this], start = this + 1, children;

		if (attrs == null) {
			attrs = {};
		} else if (typeof attrs !== "object" || attrs.tag != null || Array.isArray(attrs)) {
			attrs = {};
			start = this;
		}

		if (arguments.length === start + 1) {
			children = arguments[start];
			if (!Array.isArray(children)) children = [children];
		} else {
			children = [];
			while (start < arguments.length) children.push(arguments[start++]);
		}

		return Vnode("", attrs.key, attrs, children)
	}

	var selectorParser = /(?:(^|#|\.)([^#\.\[\]]+))|(\[(.+?)(?:\s*=\s*('|'|)((?:\\[''\]]|.)*?)\5)?\])/g;
	var selectorCache = {};

	function isEmpty(object) {
		for (var key in object) 
			if (object.hasOwnProperty(key)) 
				return false

		return true
	}

	function compileSelector(selector) {
		var match, tag = 'div', classes = [], attrs = {};
		while (match = selectorParser.exec(selector)) {
			var type = match[1], value = match[2];
			if (type === '' && value !== '') tag = value;
			else if (type === '#') attrs.id = value;
			else if (type === '.') classes.push(value);
			else if (match[3][0] === '[') {
				var attrValue = match[6];
				if (attrValue) attrValue = attrValue.replace(/\\([''])/g, '$1').replace(/\\\\/g, '\\');
				if (match[4] === 'class') classes.push(attrValue);
				else attrs[match[4]] = attrValue === '' ? attrValue : attrValue || true;
			}
		}
		if (classes.length > 0) attrs.className = classes.join(' ');
		return selectorCache[selector] = {tag: tag, attrs: attrs}
	}

	function execSelector(state, vnode) {
		var attrs = vnode.attrs;
		var children = Vnode.normalizeChildren(vnode.children);
		var hasClass = attrs.hasOwnProperty('class');
		var className = hasClass ? attrs.class : attrs.className;

		vnode.tag = state.tag;
		vnode.attrs = null;
		vnode.children = undefined;

		if (!isEmpty(state.attrs) && !isEmpty(attrs)) {
			var newAttrs = {};

			for (var key in attrs) {
				if (attrs.hasOwnProperty(key)) newAttrs[key] = attrs[key];
			}

			attrs = newAttrs;
		}

		for (var key in state.attrs) {
			if (state.attrs.hasOwnProperty(key) && key !== 'className' && !attrs.hasOwnProperty(key)){
				attrs[key] = state.attrs[key];
			}
		}
		if (className != null || state.attrs.className != null) attrs.className =
			className != null
				? state.attrs.className != null
					? String(state.attrs.className) + ' ' + String(className)
					: className
				: state.attrs.className != null
					? state.attrs.className
					: null;

		if (hasClass) attrs.class = null;

		for (var key in attrs) {
			if (attrs.hasOwnProperty(key) && key !== 'key') {
				vnode.attrs = attrs;
				break
			}
		}

		if (Array.isArray(children) && children.length === 1 && children[0] != null && children[0].tag === '#') {
			vnode.text = children[0].children;
		} else {
			vnode.children = children;
		}

		return vnode
	}

	function hyperscript(selector) {
		if (selector == null || typeof selector !== 'string' && typeof selector !== 'function' && typeof selector.view !== 'function') {
			throw Error('The selector must be either a string or a component.');
		}

		var vnode = hyperscriptVnode.apply(1, arguments);

		if (typeof selector === 'string') {
			vnode.children = Vnode.normalizeChildren(vnode.children);
			if (selector !== '[') return execSelector(selectorCache[selector] || compileSelector(selector), vnode)
		}

		vnode.tag = selector;

		if(vnode.attrs.ctx){
			vnode.ctx = vnode.attrs.ctx;
		}

		return vnode
	}

	function trust(html) {
		if (html == null) 
			html = '';
		
		return Vnode('<', undefined, undefined, html, undefined, undefined)
	}

	function fragment() {
		var vnode = hyperscriptVnode.apply(0, arguments);

		vnode.tag = "[";
		vnode.children = Vnode.normalizeChildren(vnode.children);
		
		return vnode
	}

	hyperscript.trust = trust;
	hyperscript.fragment = fragment;

	var hooks = {
		postHooks: {},
		addPost: function(hook, func){
			if(!this.postHooks[hook])
				this.postHooks[hook] = [];

			this.postHooks[hook].push(func);
		},
		hasPost: function(hook){
			return !!this.postHooks[hook]
		},
		callPost: function(hook, ret, args){
			for(let func of this.postHooks[hook]){
				ret = func.call(args[0], ret, ...args);
			}

			return ret
		}
	};

	var $doc = window.document;
	var currentRedraw;

	var nameSpace = {
		svg: "http://www.w3.org/2000/svg",
		math: "http://www.w3.org/1998/Math/MathML"
	};

	function getNameSpace(vnode) {
		return vnode.attrs && vnode.attrs.xmlns || nameSpace[vnode.tag]
	}

	//sanity check to discourage people from doing `vnode.state = ...`
	function checkState(vnode, original) {
		if (vnode.state !== original) throw new Error("'vnode.state' must not be modified.")
	}

	//Note: the hook is passed as the `this` argument to allow proxying the
	//arguments without requiring a full array allocation to do so. It also
	//takes advantage of the fact the current `vnode` is the first argument in
	//all lifecycle methods.
	//Modified: support hook patches
	function callHook(vnode) {
		var original = vnode.state;
		try {
			var ret = this.apply(original, arguments);

			if(hooks.hasPost(this.name)){
				ret = hooks.callPost(this.name, ret, arguments);
			}

			return ret
		} finally {
			checkState(vnode, original);
		}
	}

	// IE11 (at least) throws an UnspecifiedError when accessing document.activeElement when
	// inside an iframe. Catch and swallow this error, and heavy-handidly return null.
	function activeElement() {
		try {
			return $doc.activeElement
		} catch (e) {
			return null
		}
	}
	//create
	function createNodes(parent, vnodes, start, end, hooks, nextSibling, ns) {
		for (var i = start; i < end; i++) {
			var vnode = vnodes[i];
			if (vnode != null) {
				createNode(parent, vnode, hooks, ns, nextSibling);
			}
		}
	}
	function createNode(parent, vnode, hooks, ns, nextSibling) {
		var tag = vnode.tag;
		if (typeof tag === "string") {
			vnode.state = {};
			if (vnode.attrs != null) initLifecycle(vnode.attrs, vnode, hooks);
			switch (tag) {
				case "#": createText(parent, vnode, nextSibling); break
				case "<": createHTML(parent, vnode, ns, nextSibling); break
				case "[": createFragment(parent, vnode, hooks, ns, nextSibling); break
				default: createElement(parent, vnode, hooks, ns, nextSibling);
			}
		}
		else createComponent(parent, vnode, hooks, ns, nextSibling);
	}
	function createText(parent, vnode, nextSibling) {
		vnode.dom = $doc.createTextNode(vnode.children);
		insertNode(parent, vnode.dom, nextSibling);
	}
	var possibleParents = {caption: "table", thead: "table", tbody: "table", tfoot: "table", tr: "tbody", th: "tr", td: "tr", colgroup: "table", col: "colgroup"};
	function createHTML(parent, vnode, ns, nextSibling) {
		var match = vnode.children.match(/^\s*?<(\w+)/im) || [];
		// not using the proper parent makes the child element(s) vanish.
		//     var div = document.createElement("div")
		//     div.innerHTML = "<td>i</td><td>j</td>"
		//     console.log(div.innerHTML)
		// --> "ij", no <td> in sight.
		var temp = $doc.createElement(possibleParents[match[1]] || "div");
		if (ns === "http://www.w3.org/2000/svg") {
			temp.innerHTML = "<svg xmlns=\"http://www.w3.org/2000/svg\">" + vnode.children + "</svg>";
			temp = temp.firstChild;
		} else {
			temp.innerHTML = vnode.children;
		}
		vnode.dom = temp.firstChild;
		vnode.domSize = temp.childNodes.length;
		// Capture nodes to remove, so we don't confuse them.
		vnode.instance = [];
		var fragment = $doc.createDocumentFragment();
		var child;
		while (child = temp.firstChild) {
			vnode.instance.push(child);
			fragment.appendChild(child);
		}
		insertNode(parent, fragment, nextSibling);
	}
	function createFragment(parent, vnode, hooks, ns, nextSibling) {
		var fragment = $doc.createDocumentFragment();
		if (vnode.children != null) {
			var children = vnode.children;
			createNodes(fragment, children, 0, children.length, hooks, null, ns);
		}
		vnode.dom = fragment.firstChild;
		vnode.domSize = fragment.childNodes.length;
		insertNode(parent, fragment, nextSibling);
	}
	function createElement(parent, vnode, hooks, ns, nextSibling) {
		var tag = vnode.tag;
		var attrs = vnode.attrs;
		var is = attrs && attrs.is;

		ns = getNameSpace(vnode) || ns;

		var element = ns ?
			is ? $doc.createElementNS(ns, tag, {is: is}) : $doc.createElementNS(ns, tag) :
			is ? $doc.createElement(tag, {is: is}) : $doc.createElement(tag);
		vnode.dom = element;

		if (attrs != null) {
			setAttrs(vnode, attrs, ns);
		}

		insertNode(parent, element, nextSibling);

		if (!maybeSetContentEditable(vnode)) {
			if (vnode.text != null) {
				if (vnode.text !== "") element.textContent = vnode.text;
				else vnode.children = [Vnode("#", undefined, undefined, vnode.text, undefined, undefined)];
			}
			if (vnode.children != null) {
				var children = vnode.children;
				createNodes(element, children, 0, children.length, hooks, null, ns);
				if (vnode.tag === "select" && attrs != null) setLateSelectAttrs(vnode, attrs);
			}
		}
	}
	function initComponent(vnode, hooks) {
		var sentinel;
		if (typeof vnode.tag.view === "function") {
			vnode.state = Object.create(vnode.tag);
			sentinel = vnode.state.view;
			if (sentinel.$$reentrantLock$$ != null) return
			sentinel.$$reentrantLock$$ = true;
		} else {
			vnode.state = void 0;
			sentinel = vnode.tag;
			if (sentinel.$$reentrantLock$$ != null) return
			sentinel.$$reentrantLock$$ = true;
			vnode.state = (vnode.tag.prototype != null && typeof vnode.tag.prototype.view === "function") ? new vnode.tag(vnode) : vnode.tag(vnode);
		}
		initLifecycle(vnode.state, vnode, hooks);
		if (vnode.attrs != null) initLifecycle(vnode.attrs, vnode, hooks);
		vnode.instance = Vnode.normalize(callHook.call(vnode.state.view, vnode));
		if (vnode.instance === vnode) throw Error("A view cannot return the vnode it received as argument")
		sentinel.$$reentrantLock$$ = null;
	}
	function createComponent(parent, vnode, hooks, ns, nextSibling) {
		initComponent(vnode, hooks);
		if (vnode.instance != null) {
			createNode(parent, vnode.instance, hooks, ns, nextSibling);
			vnode.dom = vnode.instance.dom;
			vnode.domSize = vnode.dom != null ? vnode.instance.domSize : 0;
		}
		else {
			vnode.domSize = 0;
		}
	}

	//update
	/**
	 * @param {Element|Fragment} parent - the parent element
	 * @param {Vnode[] | null} old - the list of vnodes of the last `render()` call for
	 *                               this part of the tree
	 * @param {Vnode[] | null} vnodes - as above, but for the current `render()` call.
	 * @param {Function[]} hooks - an accumulator of post-render hooks (oncreate/onupdate)
	 * @param {Element | null} nextSibling - the next DOM node if we're dealing with a
	 *                                       fragment that is not the last item in its
	 *                                       parent
	 * @param {'svg' | 'math' | String | null} ns) - the current XML namespace, if any
	 * @returns void
	 */
	// This function diffs and patches lists of vnodes, both keyed and unkeyed.
	//
	// We will:
	//
	// 1. describe its general structure
	// 2. focus on the diff algorithm optimizations
	// 3. discuss DOM node operations.

	// ## Overview:
	//
	// The updateNodes() function:
	// - deals with trivial cases
	// - determines whether the lists are keyed or unkeyed based on the first non-null node
	//   of each list.
	// - diffs them and patches the DOM if needed (that's the brunt of the code)
	// - manages the leftovers: after diffing, are there:
	//   - old nodes left to remove?
	// 	 - new nodes to insert?
	// 	 deal with them!
	//
	// The lists are only iterated over once, with an exception for the nodes in `old` that
	// are visited in the fourth part of the diff and in the `removeNodes` loop.

	// ## Diffing
	//
	// Reading https://github.com/localvoid/ivi/blob/ddc09d06abaef45248e6133f7040d00d3c6be853/packages/ivi/src/vdom/implementation.ts#L617-L837
	// may be good for context on longest increasing subsequence-based logic for moving nodes.
	//
	// In order to diff keyed lists, one has to
	//
	// 1) match nodes in both lists, per key, and update them accordingly
	// 2) create the nodes present in the new list, but absent in the old one
	// 3) remove the nodes present in the old list, but absent in the new one
	// 4) figure out what nodes in 1) to move in order to minimize the DOM operations.
	//
	// To achieve 1) one can create a dictionary of keys => index (for the old list), then iterate
	// over the new list and for each new vnode, find the corresponding vnode in the old list using
	// the map.
	// 2) is achieved in the same step: if a new node has no corresponding entry in the map, it is new
	// and must be created.
	// For the removals, we actually remove the nodes that have been updated from the old list.
	// The nodes that remain in that list after 1) and 2) have been performed can be safely removed.
	// The fourth step is a bit more complex and relies on the longest increasing subsequence (LIS)
	// algorithm.
	//
	// the longest increasing subsequence is the list of nodes that can remain in place. Imagine going
	// from `1,2,3,4,5` to `4,5,1,2,3` where the numbers are not necessarily the keys, but the indices
	// corresponding to the keyed nodes in the old list (keyed nodes `e,d,c,b,a` => `b,a,e,d,c` would
	//  match the above lists, for example).
	//
	// In there are two increasing subsequences: `4,5` and `1,2,3`, the latter being the longest. We
	// can update those nodes without moving them, and only call `insertNode` on `4` and `5`.
	//
	// @localvoid adapted the algo to also support node deletions and insertions (the `lis` is actually
	// the longest increasing subsequence *of old nodes still present in the new list*).
	//
	// It is a general algorithm that is fireproof in all circumstances, but it requires the allocation
	// and the construction of a `key => oldIndex` map, and three arrays (one with `newIndex => oldIndex`,
	// the `LIS` and a temporary one to create the LIS).
	//
	// So we cheat where we can: if the tails of the lists are identical, they are guaranteed to be part of
	// the LIS and can be updated without moving them.
	//
	// If two nodes are swapped, they are guaranteed not to be part of the LIS, and must be moved (with
	// the exception of the last node if the list is fully reversed).
	//
	// ## Finding the next sibling.
	//
	// `updateNode()` and `createNode()` expect a nextSibling parameter to perform DOM operations.
	// When the list is being traversed top-down, at any index, the DOM nodes up to the previous
	// vnode reflect the content of the new list, whereas the rest of the DOM nodes reflect the old
	// list. The next sibling must be looked for in the old list using `getNextSibling(... oldStart + 1 ...)`.
	//
	// In the other scenarios (swaps, upwards traversal, map-based diff),
	// the new vnodes list is traversed upwards. The DOM nodes at the bottom of the list reflect the
	// bottom part of the new vnodes list, and we can use the `v.dom`  value of the previous node
	// as the next sibling (cached in the `nextSibling` variable).


	// ## DOM node moves
	//
	// In most scenarios `updateNode()` and `createNode()` perform the DOM operations. However,
	// this is not the case if the node moved (second and fourth part of the diff algo). We move
	// the old DOM nodes before updateNode runs because it enables us to use the cached `nextSibling`
	// variable rather than fetching it using `getNextSibling()`.
	//
	// The fourth part of the diff currently inserts nodes unconditionally, leading to issues
	// like #1791 and #1999. We need to be smarter about those situations where adjascent old
	// nodes remain together in the new list in a way that isn't covered by parts one and
	// three of the diff algo.

	function updateNodes(parent, old, vnodes, hooks, nextSibling, ns) {
		if (old === vnodes || old == null && vnodes == null) return
		else if (old == null || old.length === 0) createNodes(parent, vnodes, 0, vnodes.length, hooks, nextSibling, ns);
		else if (vnodes == null || vnodes.length === 0) removeNodes(parent, old, 0, old.length);
		else {
			var isOldKeyed = old[0] != null && old[0].key != null;
			var isKeyed = vnodes[0] != null && vnodes[0].key != null;
			var start = 0, oldStart = 0;
			if (!isOldKeyed) while (oldStart < old.length && old[oldStart] == null) oldStart++;
			if (!isKeyed) while (start < vnodes.length && vnodes[start] == null) start++;
			if (isOldKeyed !== isKeyed) {
				removeNodes(parent, old, oldStart, old.length);
				createNodes(parent, vnodes, start, vnodes.length, hooks, nextSibling, ns);
			} else if (!isKeyed) {
				// Don't index past the end of either list (causes deopts).
				var commonLength = old.length < vnodes.length ? old.length : vnodes.length;
				// Rewind if necessary to the first non-null index on either side.
				// We could alternatively either explicitly create or remove nodes when `start !== oldStart`
				// but that would be optimizing for sparse lists which are more rare than dense ones.
				start = start < oldStart ? start : oldStart;
				for (; start < commonLength; start++) {
					o = old[start];
					v = vnodes[start];
					if (o === v || o == null && v == null) continue
					else if (o == null) createNode(parent, v, hooks, ns, getNextSibling(old, start + 1, nextSibling));
					else if (v == null) removeNode(parent, o);
					else updateNode(parent, o, v, hooks, getNextSibling(old, start + 1, nextSibling), ns);
				}
				if (old.length > commonLength) removeNodes(parent, old, start, old.length);
				if (vnodes.length > commonLength) createNodes(parent, vnodes, start, vnodes.length, hooks, nextSibling, ns);
			} else {
				// keyed diff
				var oldEnd = old.length - 1, end = vnodes.length - 1, map, o, v, oe, ve, topSibling;

				// bottom-up
				while (oldEnd >= oldStart && end >= start) {
					oe = old[oldEnd];
					ve = vnodes[end];
					if (oe.key !== ve.key) break
					if (oe !== ve) updateNode(parent, oe, ve, hooks, nextSibling, ns);
					if (ve.dom != null) nextSibling = ve.dom;
					oldEnd--, end--;
				}
				// top-down
				while (oldEnd >= oldStart && end >= start) {
					o = old[oldStart];
					v = vnodes[start];
					if (o.key !== v.key) break
					oldStart++, start++;
					if (o !== v) updateNode(parent, o, v, hooks, getNextSibling(old, oldStart, nextSibling), ns);
				}
				// swaps and list reversals
				while (oldEnd >= oldStart && end >= start) {
					if (start === end) break
					if (o.key !== ve.key || oe.key !== v.key) break
					topSibling = getNextSibling(old, oldStart, nextSibling);
					moveNodes(parent, oe, topSibling);
					if (oe !== v) updateNode(parent, oe, v, hooks, topSibling, ns);
					if (++start <= --end) moveNodes(parent, o, nextSibling);
					if (o !== ve) updateNode(parent, o, ve, hooks, nextSibling, ns);
					if (ve.dom != null) nextSibling = ve.dom;
					oldStart++; oldEnd--;
					oe = old[oldEnd];
					ve = vnodes[end];
					o = old[oldStart];
					v = vnodes[start];
				}
				// bottom up once again
				while (oldEnd >= oldStart && end >= start) {
					if (oe.key !== ve.key) break
					if (oe !== ve) updateNode(parent, oe, ve, hooks, nextSibling, ns);
					if (ve.dom != null) nextSibling = ve.dom;
					oldEnd--, end--;
					oe = old[oldEnd];
					ve = vnodes[end];
				}
				if (start > end) removeNodes(parent, old, oldStart, oldEnd + 1);
				else if (oldStart > oldEnd) createNodes(parent, vnodes, start, end + 1, hooks, nextSibling, ns);
				else {
					// inspired by ivi https://github.com/ivijs/ivi/ by Boris Kaul
					var originalNextSibling = nextSibling, vnodesLength = end - start + 1, oldIndices = new Array(vnodesLength), li=0, i=0, pos = 2147483647, matched = 0, map, lisIndices;
					for (i = 0; i < vnodesLength; i++) oldIndices[i] = -1;
					for (i = end; i >= start; i--) {
						if (map == null) map = getKeyMap(old, oldStart, oldEnd + 1);
						ve = vnodes[i];
						var oldIndex = map[ve.key];
						if (oldIndex != null) {
							pos = (oldIndex < pos) ? oldIndex : -1; // becomes -1 if nodes were re-ordered
							oldIndices[i-start] = oldIndex;
							oe = old[oldIndex];
							old[oldIndex] = null;
							if (oe !== ve) updateNode(parent, oe, ve, hooks, nextSibling, ns);
							if (ve.dom != null) nextSibling = ve.dom;
							matched++;
						}
					}
					nextSibling = originalNextSibling;
					if (matched !== oldEnd - oldStart + 1) removeNodes(parent, old, oldStart, oldEnd + 1);
					if (matched === 0) createNodes(parent, vnodes, start, end + 1, hooks, nextSibling, ns);
					else {
						if (pos === -1) {
							// the indices of the indices of the items that are part of the
							// longest increasing subsequence in the oldIndices list
							lisIndices = makeLisIndices(oldIndices);
							li = lisIndices.length - 1;
							for (i = end; i >= start; i--) {
								v = vnodes[i];
								if (oldIndices[i-start] === -1) createNode(parent, v, hooks, ns, nextSibling);
								else {
									if (lisIndices[li] === i - start) li--;
									else moveNodes(parent, v, nextSibling);
								}
								if (v.dom != null) nextSibling = vnodes[i].dom;
							}
						} else {
							for (i = end; i >= start; i--) {
								v = vnodes[i];
								if (oldIndices[i-start] === -1) createNode(parent, v, hooks, ns, nextSibling);
								if (v.dom != null) nextSibling = vnodes[i].dom;
							}
						}
					}
				}
			}
		}
	}
	function updateNode(parent, old, vnode, hooks, nextSibling, ns) {
		var oldTag = old.tag, tag = vnode.tag;
		if (oldTag === tag) {
			vnode.state = old.state;
			vnode.events = old.events;
			if (shouldNotUpdate(vnode, old)) return
			if (typeof oldTag === "string") {
				if (vnode.attrs != null) {
					updateLifecycle(vnode.attrs, vnode, hooks);
				}
				switch (oldTag) {
					case "#": updateText(old, vnode); break
					case "<": updateHTML(parent, old, vnode, ns, nextSibling); break
					case "[": updateFragment(parent, old, vnode, hooks, nextSibling, ns); break
					default: updateElement(old, vnode, hooks, ns);
				}
			}
			else updateComponent(parent, old, vnode, hooks, nextSibling, ns);
		}
		else {
			removeNode(parent, old);
			createNode(parent, vnode, hooks, ns, nextSibling);
		}
	}
	function updateText(old, vnode) {
		if (old.children.toString() !== vnode.children.toString()) {
			old.dom.nodeValue = vnode.children;
		}
		vnode.dom = old.dom;
	}
	function updateHTML(parent, old, vnode, ns, nextSibling) {
		if (old.children !== vnode.children) {
			removeHTML(parent, old);
			createHTML(parent, vnode, ns, nextSibling);
		}
		else {
			vnode.dom = old.dom;
			vnode.domSize = old.domSize;
			vnode.instance = old.instance;
		}
	}
	function updateFragment(parent, old, vnode, hooks, nextSibling, ns) {
		updateNodes(parent, old.children, vnode.children, hooks, nextSibling, ns);
		var domSize = 0, children = vnode.children;
		vnode.dom = null;
		if (children != null) {
			for (var i = 0; i < children.length; i++) {
				var child = children[i];
				if (child != null && child.dom != null) {
					if (vnode.dom == null) vnode.dom = child.dom;
					domSize += child.domSize || 1;
				}
			}
			if (domSize !== 1) vnode.domSize = domSize;
		}
	}
	function updateElement(old, vnode, hooks, ns) {
		var element = vnode.dom = old.dom;
		ns = getNameSpace(vnode) || ns;

		if (vnode.tag === "textarea") {
			if (vnode.attrs == null) vnode.attrs = {};
			if (vnode.text != null) {
				vnode.attrs.value = vnode.text; //FIXME handle multiple children
				vnode.text = undefined;
			}
		}
		updateAttrs(vnode, old.attrs, vnode.attrs, ns);
		if (!maybeSetContentEditable(vnode)) {
			if (old.text != null && vnode.text != null && vnode.text !== "") {
				if (old.text.toString() !== vnode.text.toString()) old.dom.firstChild.nodeValue = vnode.text;
			}
			else {
				if (old.text != null) old.children = [Vnode("#", undefined, undefined, old.text, undefined, old.dom.firstChild)];
				if (vnode.text != null) vnode.children = [Vnode("#", undefined, undefined, vnode.text, undefined, undefined)];
				updateNodes(element, old.children, vnode.children, hooks, null, ns);
			}
		}
	}
	function updateComponent(parent, old, vnode, hooks, nextSibling, ns) {
		vnode.instance = Vnode.normalize(callHook.call(vnode.state.view, vnode));
		if (vnode.instance === vnode) throw Error("A view cannot return the vnode it received as argument")
		updateLifecycle(vnode.state, vnode, hooks);
		if (vnode.attrs != null) updateLifecycle(vnode.attrs, vnode, hooks);
		if (vnode.instance != null) {
			if (old.instance == null) createNode(parent, vnode.instance, hooks, ns, nextSibling);
			else updateNode(parent, old.instance, vnode.instance, hooks, nextSibling, ns);
			vnode.dom = vnode.instance.dom;
			vnode.domSize = vnode.instance.domSize;
		}
		else if (old.instance != null) {
			removeNode(parent, old.instance);
			vnode.dom = undefined;
			vnode.domSize = 0;
		}
		else {
			vnode.dom = old.dom;
			vnode.domSize = old.domSize;
		}
	}
	function getKeyMap(vnodes, start, end) {
		var map = Object.create(null);
		for (; start < end; start++) {
			var vnode = vnodes[start];
			if (vnode != null) {
				var key = vnode.key;
				if (key != null) map[key] = start;
			}
		}
		return map
	}
	// Lifted from ivi https://github.com/ivijs/ivi/
	// takes a list of unique numbers (-1 is special and can
	// occur multiple times) and returns an array with the indices
	// of the items that are part of the longest increasing
	// subsequence
	var lisTemp = [];
	function makeLisIndices(a) {
		var result = [0];
		var u = 0, v = 0, i = 0;
		var il = lisTemp.length = a.length;
		for (var i = 0; i < il; i++) lisTemp[i] = a[i];
		for (var i = 0; i < il; ++i) {
			if (a[i] === -1) continue
			var j = result[result.length - 1];
			if (a[j] < a[i]) {
				lisTemp[i] = j;
				result.push(i);
				continue
			}
			u = 0;
			v = result.length - 1;
			while (u < v) {
				// Fast integer average without overflow.
				// eslint-disable-next-line no-bitwise
				var c = (u >>> 1) + (v >>> 1) + (u & v & 1);
				if (a[result[c]] < a[i]) {
					u = c + 1;
				}
				else {
					v = c;
				}
			}
			if (a[i] < a[result[u]]) {
				if (u > 0) lisTemp[i] = result[u - 1];
				result[u] = i;
			}
		}
		u = result.length;
		v = result[u - 1];
		while (u-- > 0) {
			result[u] = v;
			v = lisTemp[v];
		}
		lisTemp.length = 0;
		return result
	}

	function getNextSibling(vnodes, i, nextSibling) {
		for (; i < vnodes.length; i++) {
			if (vnodes[i] != null && vnodes[i].dom != null) return vnodes[i].dom
		}
		return nextSibling
	}

	// This covers a really specific edge case:
	// - Parent node is keyed and contains child
	// - Child is removed, returns unresolved promise in `onbeforeremove`
	// - Parent node is moved in keyed diff
	// - Remaining children still need moved appropriately
	//
	// Ideally, I'd track removed nodes as well, but that introduces a lot more
	// complexity and I'm not exactly interested in doing that.
	function moveNodes(parent, vnode, nextSibling) {
		var frag = $doc.createDocumentFragment();
		moveChildToFrag(parent, frag, vnode);
		insertNode(parent, frag, nextSibling);
	}
	function moveChildToFrag(parent, frag, vnode) {
		// Dodge the recursion overhead in a few of the most common cases.
		while (vnode.dom != null && vnode.dom.parentNode === parent) {
			if (typeof vnode.tag !== "string") {
				vnode = vnode.instance;
				if (vnode != null) continue
			} else if (vnode.tag === "<") {
				for (var i = 0; i < vnode.instance.length; i++) {
					frag.appendChild(vnode.instance[i]);
				}
			} else if (vnode.tag !== "[") {
				// Don't recurse for text nodes *or* elements, just fragments
				frag.appendChild(vnode.dom);
			} else if (vnode.children.length === 1) {
				vnode = vnode.children[0];
				if (vnode != null) continue
			} else {
				for (var i = 0; i < vnode.children.length; i++) {
					var child = vnode.children[i];
					if (child != null) moveChildToFrag(parent, frag, child);
				}
			}
			break
		}
	}

	function insertNode(parent, dom, nextSibling) {
		if (nextSibling != null) parent.insertBefore(dom, nextSibling);
		else parent.appendChild(dom);
	}

	function maybeSetContentEditable(vnode) {
		if (vnode.attrs == null || (
			vnode.attrs.contenteditable == null && // attribute
			vnode.attrs.contentEditable == null // property
		)) return false
		var children = vnode.children;
		if (children != null && children.length === 1 && children[0].tag === "<") {
			var content = children[0].children;
			if (vnode.dom.innerHTML !== content) vnode.dom.innerHTML = content;
		}
		else if (vnode.text != null || children != null && children.length !== 0) throw new Error("Child node of a contenteditable must be trusted.")
		return true
	}

	//remove
	function removeNodes(parent, vnodes, start, end) {
		for (var i = start; i < end; i++) {
			var vnode = vnodes[i];
			if (vnode != null) removeNode(parent, vnode);
		}
	}
	function removeNode(parent, vnode) {
		var mask = 0;
		var original = vnode.state;
		var stateResult, attrsResult;
		if (typeof vnode.tag !== "string" && typeof vnode.state.onbeforeremove === "function") {
			var result = callHook.call(vnode.state.onbeforeremove, vnode);
			if (result != null && typeof result.then === "function") {
				mask = 1;
				stateResult = result;
			}
		}
		if (vnode.attrs && typeof vnode.attrs.onbeforeremove === "function") {
			var result = callHook.call(vnode.attrs.onbeforeremove, vnode);
			if (result != null && typeof result.then === "function") {
				// eslint-disable-next-line no-bitwise
				mask |= 2;
				attrsResult = result;
			}
		}
		checkState(vnode, original);

		// If we can, try to fast-path it and avoid all the overhead of awaiting
		if (!mask) {
			onremove(vnode);
			removeChild(parent, vnode);
		} else {
			if (stateResult != null) {
				var next = function () {
					// eslint-disable-next-line no-bitwise
					if (mask & 1) { mask &= 2; if (!mask) reallyRemove(); }
				};
				stateResult.then(next, next);
			}
			if (attrsResult != null) {
				var next = function () {
					// eslint-disable-next-line no-bitwise
					if (mask & 2) { mask &= 1; if (!mask) reallyRemove(); }
				};
				attrsResult.then(next, next);
			}
		}

		function reallyRemove() {
			checkState(vnode, original);
			onremove(vnode);
			removeChild(parent, vnode);
		}
	}
	function removeHTML(parent, vnode) {
		for (var i = 0; i < vnode.instance.length; i++) {
			parent.removeChild(vnode.instance[i]);
		}
	}
	function removeChild(parent, vnode) {
		// Dodge the recursion overhead in a few of the most common cases.
		while (vnode.dom != null && vnode.dom.parentNode === parent) {
			if (typeof vnode.tag !== "string") {
				vnode = vnode.instance;
				if (vnode != null) continue
			} else if (vnode.tag === "<") {
				removeHTML(parent, vnode);
			} else {
				if (vnode.tag !== "[") {
					parent.removeChild(vnode.dom);
					if (!Array.isArray(vnode.children)) break
				}
				if (vnode.children.length === 1) {
					vnode = vnode.children[0];
					if (vnode != null) continue
				} else {
					for (var i = 0; i < vnode.children.length; i++) {
						var child = vnode.children[i];
						if (child != null) removeChild(parent, child);
					}
				}
			}
			break
		}
	}
	function onremove(vnode) {
		if (typeof vnode.tag !== "string" && typeof vnode.state.onremove === "function") callHook.call(vnode.state.onremove, vnode);
		if (vnode.attrs && typeof vnode.attrs.onremove === "function") callHook.call(vnode.attrs.onremove, vnode);
		if (typeof vnode.tag !== "string") {
			if (vnode.instance != null) onremove(vnode.instance);
		} else {
			var children = vnode.children;
			if (Array.isArray(children)) {
				for (var i = 0; i < children.length; i++) {
					var child = children[i];
					if (child != null) onremove(child);
				}
			}
		}
	}

	//attrs
	function setAttrs(vnode, attrs, ns) {
		// If you assign an input type that is not supported by IE 11 with an assignment expression, an error will occur.
		//
		// Also, the DOM does things to inputs based on the value, so it needs set first.
		// See: https://github.com/MithrilJS/mithril.js/issues/2622
		if (vnode.tag === "input" && attrs.type != null) vnode.dom.setAttribute("type", attrs.type);
		var isFileInput = attrs != null && vnode.tag === "input" && attrs.type === "file";
		for (var key in attrs) {
			setAttr(vnode, key, null, attrs[key], ns, isFileInput);
		}
	}
	function setAttr(vnode, key, old, value, ns, isFileInput) {
		if (key === "key" || key === "is" || value == null || isLifecycleMethod(key) || (old === value && !isFormAttribute(vnode, key)) && typeof value !== "object" || key === "type" && vnode.tag === "input") return
		if (key[0] === "o" && key[1] === "n") return updateEvent(vnode, key, value)
		if (key.slice(0, 6) === "xlink:") vnode.dom.setAttributeNS("http://www.w3.org/1999/xlink", key.slice(6), value);
		else if (key === "style") updateStyle(vnode.dom, old, value);
		else if (hasPropertyKey(vnode, key, ns)) {
			if (key === "value") {
				// Only do the coercion if we're actually going to check the value.
				/* eslint-disable no-implicit-coercion */
				//setting input[value] to same value by typing on focused element moves cursor to end in Chrome
				//setting input[type=file][value] to same value causes an error to be generated if it's non-empty
				if ((vnode.tag === "input" || vnode.tag === "textarea") && vnode.dom.value === "" + value && (isFileInput || vnode.dom === activeElement())) return
				//setting select[value] to same value while having select open blinks select dropdown in Chrome
				if (vnode.tag === "select" && old !== null && vnode.dom.value === "" + value) return
				//setting option[value] to same value while having select open blinks select dropdown in Chrome
				if (vnode.tag === "option" && old !== null && vnode.dom.value === "" + value) return
				//setting input[type=file][value] to different value is an error if it's non-empty
				// Not ideal, but it at least works around the most common source of uncaught exceptions for now.
				if (isFileInput && "" + value !== "") { console.error("`value` is read-only on file inputs!"); return }
				/* eslint-enable no-implicit-coercion */
			}
			vnode.dom[key] = value;
		} else {
			if (typeof value === "boolean") {
				if (value) vnode.dom.setAttribute(key, "");
				else vnode.dom.removeAttribute(key);
			}
			else vnode.dom.setAttribute(key === "className" ? "class" : key, value);
		}
	}
	function removeAttr(vnode, key, old, ns) {
		if (key === "key" || key === "is" || old == null || isLifecycleMethod(key)) return
		if (key[0] === "o" && key[1] === "n") updateEvent(vnode, key, undefined);
		else if (key === "style") updateStyle(vnode.dom, old, null);
		else if (
			hasPropertyKey(vnode, key, ns)
			&& key !== "className"
			&& !(key === "value" && (
				vnode.tag === "option"
				|| vnode.tag === "select" && vnode.dom.selectedIndex === -1 && vnode.dom === activeElement()
			))
			&& !(vnode.tag === "input" && key === "type")
		) {
			vnode.dom[key] = null;
		} else {
			var nsLastIndex = key.indexOf(":");
			if (nsLastIndex !== -1) key = key.slice(nsLastIndex + 1);
			if (old !== false) vnode.dom.removeAttribute(key === "className" ? "class" : key);
		}
	}
	function setLateSelectAttrs(vnode, attrs) {
		if ("value" in attrs) {
			if(attrs.value === null) {
				if (vnode.dom.selectedIndex !== -1) vnode.dom.value = null;
			} else {
				var normalized = "" + attrs.value; // eslint-disable-line no-implicit-coercion
				if (vnode.dom.value !== normalized || vnode.dom.selectedIndex === -1) {
					vnode.dom.value = normalized;
				}
			}
		}
		if ("selectedIndex" in attrs) setAttr(vnode, "selectedIndex", null, attrs.selectedIndex, undefined);
	}
	function updateAttrs(vnode, old, attrs, ns) {
		if (attrs != null) {
			// If you assign an input type that is not supported by IE 11 with an assignment expression, an error will occur.
			//
			// Also, the DOM does things to inputs based on the value, so it needs set first.
			// See: https://github.com/MithrilJS/mithril.js/issues/2622
			if (vnode.tag === "input" && attrs.type != null) vnode.dom.setAttribute("type", attrs.type);
			var isFileInput = vnode.tag === "input" && attrs.type === "file";
			for (var key in attrs) {
				setAttr(vnode, key, old && old[key], attrs[key], ns, isFileInput);
			}
		}
		var val;
		if (old != null) {
			for (var key in old) {
				if (((val = old[key]) != null) && (attrs == null || attrs[key] == null)) {
					removeAttr(vnode, key, val, ns);
				}
			}
		}
	}
	function isFormAttribute(vnode, attr) {
		return attr === "value" || attr === "checked" || attr === "selectedIndex" || attr === "selected" && vnode.dom === activeElement() || vnode.tag === "option" && vnode.dom.parentNode === $doc.activeElement
	}
	function isLifecycleMethod(attr) {
		return attr === "oninit" || attr === "oncreate" || attr === "onupdate" || attr === "onremove" || attr === "onbeforeremove" || attr === "onbeforeupdate"
	}
	function hasPropertyKey(vnode, key, ns) {
		// Filter out namespaced keys
		return ns === undefined && (
			// If it's a custom element, just keep it.
			vnode.tag.indexOf("-") > -1 || vnode.attrs != null && vnode.attrs.is ||
			// If it's a normal element, let's try to avoid a few browser bugs.
			key !== "href" && key !== "list" && key !== "form" && key !== "width" && key !== "height"// && key !== "type"
			// Defer the property check until *after* we check everything.
		) && key in vnode.dom
	}

	//style
	var uppercaseRegex = /[A-Z]/g;
	function toLowerCase(capital) { return "-" + capital.toLowerCase() }
	function normalizeKey(key) {
		return key[0] === "-" && key[1] === "-" ? key :
			key === "cssFloat" ? "float" :
				key.replace(uppercaseRegex, toLowerCase)
	}
	function updateStyle(element, old, style) {
		if (old === style) ; else if (style == null) {
			// New style is missing, just clear it.
			element.style.cssText = "";
		} else if (typeof style !== "object") {
			// New style is a string, let engine deal with patching.
			element.style.cssText = style;
		} else if (old == null || typeof old !== "object") {
			// `old` is missing or a string, `style` is an object.
			element.style.cssText = "";
			// Add new style properties
			for (var key in style) {
				var value = style[key];
				if (value != null) element.style.setProperty(normalizeKey(key), String(value));
			}
		} else {
			// Both old & new are (different) objects.
			// Update style properties that have changed
			for (var key in style) {
				var value = style[key];
				if (value != null && (value = String(value)) !== String(old[key])) {
					element.style.setProperty(normalizeKey(key), value);
				}
			}
			// Remove style properties that no longer exist
			for (var key in old) {
				if (old[key] != null && style[key] == null) {
					element.style.removeProperty(normalizeKey(key));
				}
			}
		}
	}

	// Here's an explanation of how this works:
	// 1. The event names are always (by design) prefixed by `on`.
	// 2. The EventListener interface accepts either a function or an object
	//    with a `handleEvent` method.
	// 3. The object does not inherit from `Object.prototype`, to avoid
	//    any potential interference with that (e.g. setters).
	// 4. The event name is remapped to the handler before calling it.
	// 5. In function-based event handlers, `ev.target === this`. We replicate
	//    that below.
	// 6. In function-based event handlers, `return false` prevents the default
	//    action and stops event propagation. We replicate that below.
	function EventDict() {
		// Save this, so the current redraw is correctly tracked.
		this._ = currentRedraw;
	}
	EventDict.prototype = Object.create(null);
	EventDict.prototype.handleEvent = function (ev) {
		var handler = this["on" + ev.type];
		var result;
		if (typeof handler === "function") result = handler.call(ev.currentTarget, ev);
		else if (typeof handler.handleEvent === "function") handler.handleEvent(ev);
		if (this._ && ev.redraw !== false) (0, this._)();
		if (result === false) {
			ev.preventDefault();
			ev.stopPropagation();
		}
	};

	//event
	function updateEvent(vnode, key, value) {
		if (vnode.events != null) {
			vnode.events._ = currentRedraw;
			if (vnode.events[key] === value) return
			if (value != null && (typeof value === "function" || typeof value === "object")) {
				if (vnode.events[key] == null) vnode.dom.addEventListener(key.slice(2), vnode.events, false);
				vnode.events[key] = value;
			} else {
				if (vnode.events[key] != null) vnode.dom.removeEventListener(key.slice(2), vnode.events, false);
				vnode.events[key] = undefined;
			}
		} else if (value != null && (typeof value === "function" || typeof value === "object")) {
			vnode.events = new EventDict();
			vnode.dom.addEventListener(key.slice(2), vnode.events, false);
			vnode.events[key] = value;
		}
	}

	//lifecycle
	function initLifecycle(source, vnode, hooks) {
		if (typeof source.oninit === "function"){
			let ret = callHook.call(source.oninit, vnode);

			if(ret instanceof Promise){
				ret.then(currentRedraw);
			}
		}

		if (typeof source.oncreate === "function") 
			hooks.push(callHook.bind(source.oncreate, vnode));
	}
	function updateLifecycle(source, vnode, hooks) {
		if (typeof source.onupdate === "function") hooks.push(callHook.bind(source.onupdate, vnode));
	}
	function shouldNotUpdate(vnode, old) {
		do {
			if (vnode.attrs != null && typeof vnode.attrs.onbeforeupdate === "function") {
				var force = callHook.call(vnode.attrs.onbeforeupdate, vnode, old);
				if (force !== undefined && !force) break
			}
			if (typeof vnode.tag !== "string" && typeof vnode.state.onbeforeupdate === "function") {
				var force = callHook.call(vnode.state.onbeforeupdate, vnode, old);
				if (force !== undefined && !force) break
			}
			return false
		} while (false); // eslint-disable-line no-constant-condition
		vnode.dom = old.dom;
		vnode.domSize = old.domSize;
		vnode.instance = old.instance;
		// One would think having the actual latest attributes would be ideal,
		// but it doesn't let us properly diff based on our current internal
		// representation. We have to save not only the old DOM info, but also
		// the attributes used to create it, as we diff *that*, not against the
		// DOM directly (with a few exceptions in `setAttr`). And, of course, we
		// need to save the children and text as they are conceptually not
		// unlike special "attributes" internally.
		vnode.attrs = old.attrs;
		vnode.children = old.children;
		vnode.text = old.text;
		return true
	}

	var currentDOM;

	function render(dom, vnodes, redraw) {
		if (!dom) throw new TypeError("DOM element being rendered to does not exist.")
		if (currentDOM != null && dom.contains(currentDOM)) {
			throw new TypeError("Node is currently being rendered to and thus is locked.")
		}
		var prevRedraw = currentRedraw;
		var prevDOM = currentDOM;
		var hooks = [];
		var active = activeElement();
		var namespace = dom.namespaceURI;


		currentDOM = dom;
		currentRedraw = typeof redraw === "function" ? redraw : undefined;
		try {
			// First time rendering into a node clears it out
			if (dom.vnodes == null) dom.textContent = "";
			vnodes = Vnode.normalizeChildren(Array.isArray(vnodes) ? vnodes : [vnodes]);
			updateNodes(dom, dom.vnodes, vnodes, hooks, null, namespace === "http://www.w3.org/1999/xhtml" ? undefined : namespace);
			dom.vnodes = vnodes;
			// `document.activeElement` can return null: https://html.spec.whatwg.org/multipage/interaction.html#dom-document-activeelement
			if (active != null && activeElement() !== active && typeof active.focus === "function") active.focus();
			for (var i = 0; i < hooks.length; i++){
				let ret = hooks[i]();

				if(ret instanceof Promise)
					ret.then(currentRedraw);
			}
		} finally {
			currentRedraw = prevRedraw;
			currentDOM = prevDOM;
		}
	}

	function makeMount() {
		var subscriptions = [];
		var pending = false;
		var offset = -1;

		function sync() {
			for (offset = 0; offset < subscriptions.length; offset += 2) {
				try{ 
					render(subscriptions[offset], Vnode(subscriptions[offset + 1]), redraw); 
				}catch(e){ 
					console.error(e); 
				}
			}
			offset = -1;
		}

		function redraw() {
			if (!pending) {
				pending = true;
				requestAnimationFrame(() => {
					pending = false;
					sync();
				});
			}
		}

		redraw.sync = sync;

		function mount(root, component) {
			if (component != null && component.view == null && typeof component !== "function") {
				throw new TypeError("m.mount expects a component, not a vnode.")
			}

			var index = subscriptions.indexOf(root);
			if (index >= 0) {
				subscriptions.splice(index, 2);
				if (index <= offset) offset -= 2;
				render(root, []);
			}

			if (component != null) {
				subscriptions.push(root, component);
				render(root, Vnode(component), redraw);
			}
		}

		return {mount: mount, redraw: redraw}
	}

	var magic = /^(?:key|oninit|oncreate|onbeforeupdate|onupdate|onbeforeremove|onremove)$/;

	function censor(attrs, extras) {
		var result = {};

		if (extras != null) {
			for (var key in attrs) {
				if (attrs.hasOwnProperty(key) && !magic.test(key) && extras.indexOf(key) < 0) {
					result[key] = attrs[key];
				}
			}
		} else {
			for (var key in attrs) {
				if (attrs.hasOwnProperty(key) && !magic.test(key)) {
					result[key] = attrs[key];
				}
			}
		}

		return result
	}

	function build$1(object) {
		if (Object.prototype.toString.call(object) !== "[object Object]") return ""

		var args = [];
		for (var key in object) {
			destructure(key, object[key]);
		}

		return args.join("&")

		function destructure(key, value) {
			if (Array.isArray(value)) {
				for (var i = 0; i < value.length; i++) {
					destructure(key + "[" + i + "]", value[i]);
				}
			}
			else if (Object.prototype.toString.call(value) === "[object Object]") {
				for (var i in value) {
					destructure(key + "[" + i + "]", value[i]);
				}
			}
			else args.push(encodeURIComponent(key) + (value != null && value !== "" ? "=" + encodeURIComponent(value) : ""));
		}
	}


	function parse$1(string) {
		if (string === "" || string == null) return {}
		if (string.charAt(0) === "?") string = string.slice(1);

		var entries = string.split("&"), counters = {}, data = {};
		for (var i = 0; i < entries.length; i++) {
			var entry = entries[i].split("=");
			var key = decodeURIComponent(entry[0]);
			var value = entry.length === 2 ? decodeURIComponent(entry[1]) : "";

			if (value === "true") value = true;
			else if (value === "false") value = false;

			var levels = key.split(/\]\[?|\[/);
			var cursor = data;
			if (key.indexOf("[") > -1) levels.pop();
			for (var j = 0; j < levels.length; j++) {
				var level = levels[j], nextLevel = levels[j + 1];
				var isNumber = nextLevel == "" || !isNaN(parseInt(nextLevel, 10));
				if (level === "") {
					var key = levels.slice(0, j).join();
					if (counters[key] == null) {
						counters[key] = Array.isArray(cursor) ? cursor.length : 0;
					}
					level = counters[key]++;
				}
				// Disallow direct prototype pollution
				else if (level === "__proto__") break
				if (j === levels.length - 1) cursor[level] = value;
				else {
					// Read own properties exclusively to disallow indirect
					// prototype pollution
					var desc = Object.getOwnPropertyDescriptor(cursor, level);
					if (desc != null) desc = desc.value;
					if (desc == null) cursor[level] = desc = isNumber ? [] : {};
					cursor = desc;
				}
			}
		}
		return data
	}

	function build(template, params) {
		if ((/:([^\/\.-]+)(\.{3})?:/).test(template)) {
			throw new SyntaxError("Template parameter names must be separated by either a '/', '-', or '.'.")
		}
		if (params == null) return template
		var queryIndex = template.indexOf("?");
		var hashIndex = template.indexOf("#");
		var queryEnd = hashIndex < 0 ? template.length : hashIndex;
		var pathEnd = queryIndex < 0 ? queryEnd : queryIndex;
		var path = template.slice(0, pathEnd);
		var query = {};

		Object.assign(query, params);

		var resolved = path.replace(/:([^\/\.-]+)(\.{3})?/g, function(m, key, variadic) {
			delete query[key];
			// If no such parameter exists, don't interpolate it.
			if (params[key] == null) return m
			// Escape normal parameters, but not variadic ones.
			return variadic ? params[key] : encodeURIComponent(String(params[key]))
		});

		// In case the template substitution adds new query/hash parameters.
		var newQueryIndex = resolved.indexOf("?");
		var newHashIndex = resolved.indexOf("#");
		var newQueryEnd = newHashIndex < 0 ? resolved.length : newHashIndex;
		var newPathEnd = newQueryIndex < 0 ? newQueryEnd : newQueryIndex;
		var result = resolved.slice(0, newPathEnd);

		if (queryIndex >= 0) result += template.slice(queryIndex, queryEnd);
		if (newQueryIndex >= 0) result += (queryIndex < 0 ? "?" : "&") + resolved.slice(newQueryIndex, newQueryEnd);
		var querystring = build$1(query);
		if (querystring) result += (queryIndex < 0 && newQueryIndex < 0 ? "?" : "&") + querystring;
		if (hashIndex >= 0) result += template.slice(hashIndex);
		if (newHashIndex >= 0) result += (hashIndex < 0 ? "" : "&") + resolved.slice(newHashIndex);
		return result
	}


	function compileTemplate(template) {
		var templateData = parse(template);
		var templateKeys = Object.keys(templateData.params);
		var keys = [];
		var regexp = new RegExp("^" + templateData.path.replace(
			// I escape literal text so people can use things like `:file.:ext` or
			// `:lang-:locale` in routes. This is all merged into one pass so I
			// don't also accidentally escape `-` and make it harder to detect it to
			// ban it from template parameters.
			/:([^\/.-]+)(\.{3}|\.(?!\.)|-)?|[\\^$*+.()|\[\]{}]/g,
			function(m, key, extra) {
				if (key == null) return "\\" + m
				keys.push({k: key, r: extra === "..."});
				if (extra === "...") return "(.*)"
				if (extra === ".") return "([^/]+)\\."
				return "([^/]+)" + (extra || "")
			}
		) + "$");
		return function(data) {
			// First, check the params. Usually, there isn't any, and it's just
			// checking a static set.
			for (var i = 0; i < templateKeys.length; i++) {
				if (templateData.params[templateKeys[i]] !== data.params[templateKeys[i]]) return false
			}
			// If no interpolations exist, let's skip all the ceremony
			if (!keys.length) return regexp.test(data.path)
			var values = regexp.exec(data.path);
			if (values == null) return false
			for (var i = 0; i < keys.length; i++) {
				data.params[keys[i].k] = keys[i].r ? values[i + 1] : decodeURIComponent(values[i + 1]);
			}
			return true
		}
	}


	function parse(url) {
		var queryIndex = url.indexOf("?");
		var hashIndex = url.indexOf("#");
		var queryEnd = hashIndex < 0 ? url.length : hashIndex;
		var pathEnd = queryIndex < 0 ? queryEnd : queryIndex;
		var path = url.slice(0, pathEnd).replace(/\/{2,}/g, "/");

		if (!path) path = "/";
		else {
			if (path[0] !== "/") path = "/" + path;
			if (path.length > 1 && path[path.length - 1] === "/") path = path.slice(0, -1);
		}
		return {
			path: path,
			params: queryIndex < 0
				? {}
				: parse$1(url.slice(queryIndex + 1, queryEnd)),
		}
	}

	var pathname = /*#__PURE__*/Object.freeze({
		__proto__: null,
		build: build,
		compileTemplate: compileTemplate,
		parse: parse
	});

	var sentinel = {};

	function makeRoute(mountSpace) {
		var callAsync = window.setTimeout;
		var p = Promise.resolve();

		var scheduled = false;

		// state === 0: init
		// state === 1: scheduled
		// state === 2: done
		var ready = false;
		var state = 0;

		var compiled, fallbackRoute;

		var currentResolver = sentinel, component, attrs, currentPath, lastUpdate;

		var RouterRoot = {
			onbeforeupdate: function() {
				state = state ? 2 : 1;
				return !(!state || sentinel === currentResolver)
			},
			onremove: function() {
				window.removeEventListener("popstate", fireAsync, false);
				window.removeEventListener("hashchange", resolveRoute, false);
			},
			view: function() {
				if (!state || sentinel === currentResolver) return
				// Wrap in a fragment to preserve existing key semantics
				var vnode = [Vnode(component, attrs.key, attrs)];
				if (currentResolver) vnode = currentResolver.render(vnode[0]);
				return vnode
			},
		};

		var SKIP = route.SKIP = {};

		function resolveRoute() {
			scheduled = false;
			// Consider the pathname holistically. The prefix might even be invalid,
			// but that's not our problem.
			var prefix = window.location.hash;
			if (route.prefix[0] !== "#") {
				prefix = window.location.search + prefix;
				if (route.prefix[0] !== "?") {
					prefix = window.location.pathname + prefix;
					if (prefix[0] !== "/") prefix = "/" + prefix;
				}
			}
			// This seemingly useless `.concat()` speeds up the tests quite a bit,
			// since the representation is consistently a relatively poorly
			// optimized cons string.
			var path = prefix.concat()
				.replace(/(?:%[a-f89][a-f0-9])+/gim, decodeURIComponent)
				.slice(route.prefix.length);
			var data = parse(path);

			Object.assign(data.params, window.history.state);

			function reject(e) {
				console.error(e);
				setPath(fallbackRoute, null, {replace: true});
			}

			loop(0);
			function loop(i) {
				// state === 0: init
				// state === 1: scheduled
				// state === 2: done
				for (; i < compiled.length; i++) {
					if (compiled[i].check(data)) {
						var payload = compiled[i].component;
						var matchedRoute = compiled[i].route;
						var localComp = payload;
						var update = lastUpdate = function(comp) {
							if (update !== lastUpdate) return
							if (comp === SKIP) return loop(i + 1)
							component = comp != null && (typeof comp.view === "function" || typeof comp === "function")? comp : "div";
							attrs = data.params, currentPath = path, lastUpdate = null;
							currentResolver = payload.render ? payload : null;
							if (state === 2) mountSpace.redraw();
							else {
								state = 2;
								mountSpace.redraw.sync();
							}
						};
						// There's no understating how much I *wish* I could
						// use `async`/`await` here...
						if (payload.view || typeof payload === "function") {
							payload = {};
							update(localComp);
						}
						else if (payload.onmatch) {
							p.then(function () {
								return payload.onmatch(data.params, path, matchedRoute)
							}).then(update, path === fallbackRoute ? null : reject);
						}
						else update("div");
						return
					}
				}

				if (path === fallbackRoute) {
					throw new Error("Could not resolve default route " + fallbackRoute + ".")
				}
				setPath(fallbackRoute, null, {replace: true});
			}
		}

		// Set it unconditionally so `m.route.set` and `m.route.Link` both work,
		// even if neither `pushState` nor `hashchange` are supported. It's
		// cleared if `hashchange` is used, since that makes it automatically
		// async.
		function fireAsync() {
			if (!scheduled) {
				scheduled = true;
				// TODO: just do `mountSpace.redraw()` here and elide the timer
				// dependency. Note that this will muck with tests a *lot*, so it's
				// not as easy of a change as it sounds.
				callAsync(resolveRoute);
			}
		}

		function setPath(path, data, options) {
			path = build(path, data);
			if (ready) {
				fireAsync();
				var state = options ? options.state : null;
				var title = options ? options.title : null;
				if (options && options.replace) window.history.replaceState(state, title, route.prefix + path);
				else window.history.pushState(state, title, route.prefix + path);
			}
			else {
				window.location.href = route.prefix + path;
			}
		}

		function route(root, defaultRoute, routes) {
			if (!root) throw new TypeError("DOM element being rendered to does not exist.")

			compiled = Object.keys(routes).map(function(route) {
				if (route[0] !== "/") throw new SyntaxError("Routes must start with a '/'.")
				if ((/:([^\/\.-]+)(\.{3})?:/).test(route)) {
					throw new SyntaxError("Route parameter names must be separated with either '/', '.', or '-'.")
				}
				return {
					route: route,
					component: routes[route],
					check: compileTemplate(route),
				}
			});
			fallbackRoute = defaultRoute;
			if (defaultRoute != null) {
				var defaultData = parse(defaultRoute);

				if (!compiled.some(function (i) { return i.check(defaultData) })) {
					throw new ReferenceError("Default route doesn't match any known routes.")
				}
			}

			if (typeof window.history.pushState === "function") {
				window.addEventListener("popstate", fireAsync, false);
			} else if (route.prefix[0] === "#") {
				window.addEventListener("hashchange", resolveRoute, false);
			}

			ready = true;
			mountSpace.mount(root, RouterRoot);
			resolveRoute();
		}
		route.set = function(path, data, options) {
			if (lastUpdate != null) {
				options = options || {};
				options.replace = true;
			}
			lastUpdate = null;
			setPath(path, data, options);
		};
		route.get = function() {return currentPath};
		route.prefix = "#!";
		route.Link = {
			view: function(vnode) {
				// Omit the used parameters from the rendered element - they are
				// internal. Also, censor the various lifecycle methods.
				//
				// We don't strip the other parameters because for convenience we
				// let them be specified in the selector as well.
				var child = hyperscript(
					vnode.attrs.selector || "a",
					censor(vnode.attrs, ["options", "params", "selector", "onclick"]),
					vnode.children
				);
				var options, onclick, href;

				// Let's provide a *right* way to disable a route link, rather than
				// letting people screw up accessibility on accident.
				//
				// The attribute is coerced so users don't get surprised over
				// `disabled: 0` resulting in a button that's somehow routable
				// despite being visibly disabled.
				if (child.attrs.disabled = Boolean(child.attrs.disabled)) {
					child.attrs.href = null;
					child.attrs["aria-disabled"] = "true";
					// If you *really* do want add `onclick` on a disabled link, use
					// an `oncreate` hook to add it.
				} else {
					options = vnode.attrs.options;
					onclick = vnode.attrs.onclick;
					// Easier to build it now to keep it isomorphic.
					href = build(child.attrs.href, vnode.attrs.params);
					child.attrs.href = route.prefix + href;
					child.attrs.onclick = function(e) {
						var result;
						if (typeof onclick === "function") {
							result = onclick.call(e.currentTarget, e);
						} else if (onclick == null || typeof onclick !== "object") ; else if (typeof onclick.handleEvent === "function") {
							onclick.handleEvent(e);
						}

						// Adapted from React Router's implementation:
						// https://github.com/ReactTraining/react-router/blob/520a0acd48ae1b066eb0b07d6d4d1790a1d02482/packages/react-router-dom/modules/Link.js
						//
						// Try to be flexible and intuitive in how we handle links.
						// Fun fact: links aren't as obvious to get right as you
						// would expect. There's a lot more valid ways to click a
						// link than this, and one might want to not simply click a
						// link, but right click or command-click it to copy the
						// link target, etc. Nope, this isn't just for blind people.
						if (
							// Skip if `onclick` prevented default
							result !== false && !e.defaultPrevented &&
							// Ignore everything but left clicks
							(e.button === 0 || e.which === 0 || e.which === 1) &&
							// Let the browser handle `target=_blank`, etc.
							(!e.currentTarget.target || e.currentTarget.target === "_self") &&
							// No modifier keys
							!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey
						) {
							e.preventDefault();
							e.redraw = false;
							route.set(href, null, options);
						}
					};
				}
				return child
			},
		};
		route.param = function(key) {
			return attrs && key != null ? attrs[key] : attrs
		};

		return route
	}

	const mountSpace = makeMount();
	const route = makeRoute(mountSpace);

	function m() { 
		return hyperscript.apply(this, arguments) 
	}

	m.m = hyperscript;
	m.trust = hyperscript.trust;
	m.fragment = hyperscript.fragment;
	m.render = render;
	m.mount = mountSpace.mount;
	m.redraw = mountSpace.redraw;
	m.route = route;
	m.vnode = Vnode;
	m.hooks = hooks;
	m.pathname = pathname;

	function c(selector, attrs, ...children){
		if(attrs && attrs.classes){
			attrs.class = attrs.classes.filter(c => c).join(' ');
			delete attrs.classes;
		}

		if(children.length <= 1){
			children = children[0];
		}

		if(selector === 'a'){
			if(attrs && attrs.href && attrs.href.charAt(0) !== '#' && !attrs.external && attrs.href.indexOf('https://') !== 0){
				selector = m.route.Link;
			}
		}else if(selector === 'frag'){
			selector = '[';
		}

		return m(selector, attrs, children)
	}

	Object.assign(c, m);

	c.hooks.addPost('view', (ret, node) => {
		if(node.ctx){
			let stack = [ret];

			while(stack.length > 0){
				let v = stack.pop();

				if(!v || typeof v !== 'object')
					continue

				v.ctx = node.ctx;

				if(node.ctx && node.ctx.t){
					if(typeof v.text === 'string' && v.text.charAt(0) === '@'){
						v.text = node.ctx.t(v.text.slice(1));
					}else if(v.tag === '#' && typeof v.children === 'string' && v.children.charAt(0) === '@'){
						v.children = node.ctx.t(v.children.slice(1));
					}
				}


				if(v.children && typeof v.children === 'object'){
					if(Array.isArray(v.children))
						stack.push(...v.children);
					else
						stack.push(v.children);
				}
			}
		}

		return ret
	});

	function EventEmitter$1(){
		this.listeners = [];
		this.dispatched = [];
	}

	EventEmitter$1.prototype.on = function(type,callback){
		var listener = {type:type,callback:callback};
		this.listeners.push(listener);
	};

	EventEmitter$1.prototype.once = function(type,callback){
		var listener = {type:type,callback:callback,once:true};
		this.listeners.push(listener);
	};

	EventEmitter$1.prototype.when = function(type,callback,keep){
		if(this.dispatched.indexOf(type)!=-1){
			callback();
			if(!keep)
				return
		}
		var listener = {type:type,callback:callback,once:!keep,when:true};
		this.listeners.push(listener);
	};

	EventEmitter$1.prototype.off = function(type,callback){
		for(var i in this.listeners){
			if(this.listeners[i].type==type){
				if(!callback || this.listeners[i].callback==callback)
					this.listeners.splice(i,1);
			}
		}
	};

	EventEmitter$1.prototype.emit = function(type,data){
		if(this.dispatched.indexOf(type)==-1)
			this.dispatched.push(type);

		for(var i=0;i<this.listeners.length;i++){
			if(i<0)
				continue
			if(this.listeners[i].type==type){
				this.listeners[i].callback.apply(null,Array.prototype.slice.call(arguments,1));
				if(this.listeners[i] && this.listeners[i].once){
					this.listeners.splice(i,1);
					i--;
				}
			}
		}
	};

	class BaseModel extends EventEmitter$1{
		assign(data){
			let overrides = {};

			if(this.assignMappers){
				for(let key of Object.keys(data)){
					for(let { mapper } of this.assignMappers.filter(m => m.key === key)){
						overrides[key] = mapper(overrides[key] || data[key]);
					}
				}
			}

			Object.assign(this, data, overrides);
			return this
		}

		assignMap(key, mapper){
			if(!this.assignMappers){
				this.assignMappers = [];
			}

			if(typeof mapper === 'string'){
				let route = mapper;
				let arrayBased = route.charAt(0) === '[' && route.charAt(route.length-1) === ']';

				if(arrayBased)
					route = route.slice(1, -1);

				mapper = input => {
					if(this.ctx.models.instanceof(input, route))
						return input

					return this.ctx.models.new(route, input)
						.assign(input)
				};

				if(arrayBased){
					let singleMapper = mapper;

					mapper = input => Array.isArray(input) ? input.map(i => singleMapper(i)) : singleMapper(i);
				}
			}

			this.assignMappers.push({key, mapper});
		}
	}

	var Nav = {
	  view: node => {
	    let {
	      items,
	      active,
	      replace,
	      ...attrs
	    } = node.attrs;
	    let cls = attrs.class || '';
	    return c("nav", {
	      class: `styled ${cls}`
	    }, c("ul", null, (() => {
	      let e = [];

	      for (let {
	        key,
	        label,
	        href,
	        onclick
	      } of items) {
	        e.push(c('[', null, c("li", {
	          class: key === node.attrs.active ? 'active' : ''
	        }, c("a", {
	          class: `can-have-underline ${key === active ? 'has-underline primary' : ''}`,
	          href: href,
	          options: {
	            replace
	          },
	          onclick: onclick
	        }, label))));
	      }
	      return e;
	    })()));
	  }
	};

	var Currency = {
	  view: node => {
	    let {
	      currency
	    } = node.attrs;
	    let name = currency.currency;
	    let issuer = currency.issuer ? currency.issuer.slice(0, 8) + '...' : null;
	    return c("div", {
	      class: `currency ${node.attrs.class || ''}`
	    }, name === 'XRP' ? c('[', null, c("i", {
	      class: "currency xrp"
	    })) : c('[', null, c("i", {
	      class: "currency placeholder"
	    })), c("div", null, c("span", {
	      class: "name"
	    }, name), node.attrs.showIssuer && issuer ? c('[', null, c("span", {
	      class: "issuer"
	    }, issuer)) : null));
	  }
	};

	/*
	 *  decimal.js v10.3.1
	 *  An arbitrary-precision Decimal type for JavaScript.
	 *  https://github.com/MikeMcl/decimal.js
	 *  Copyright (c) 2021 Michael Mclaughlin <M8ch88l@gmail.com>
	 *  MIT Licence
	 */


	// -----------------------------------  EDITABLE DEFAULTS  ------------------------------------ //


	  // The maximum exponent magnitude.
	  // The limit on the value of `toExpNeg`, `toExpPos`, `minE` and `maxE`.
	var EXP_LIMIT = 9e15,                      // 0 to 9e15

	  // The limit on the value of `precision`, and on the value of the first argument to
	  // `toDecimalPlaces`, `toExponential`, `toFixed`, `toPrecision` and `toSignificantDigits`.
	  MAX_DIGITS = 1e9,                        // 0 to 1e9

	  // Base conversion alphabet.
	  NUMERALS = '0123456789abcdef',

	  // The natural logarithm of 10 (1025 digits).
	  LN10 = '2.3025850929940456840179914546843642076011014886287729760333279009675726096773524802359972050895982983419677840422862486334095254650828067566662873690987816894829072083255546808437998948262331985283935053089653777326288461633662222876982198867465436674744042432743651550489343149393914796194044002221051017141748003688084012647080685567743216228355220114804663715659121373450747856947683463616792101806445070648000277502684916746550586856935673420670581136429224554405758925724208241314695689016758940256776311356919292033376587141660230105703089634572075440370847469940168269282808481184289314848524948644871927809676271275775397027668605952496716674183485704422507197965004714951050492214776567636938662976979522110718264549734772662425709429322582798502585509785265383207606726317164309505995087807523710333101197857547331541421808427543863591778117054309827482385045648019095610299291824318237525357709750539565187697510374970888692180205189339507238539205144634197265287286965110862571492198849978748873771345686209167058',

	  // Pi (1025 digits).
	  PI = '3.1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679821480865132823066470938446095505822317253594081284811174502841027019385211055596446229489549303819644288109756659334461284756482337867831652712019091456485669234603486104543266482133936072602491412737245870066063155881748815209209628292540917153643678925903600113305305488204665213841469519415116094330572703657595919530921861173819326117931051185480744623799627495673518857527248912279381830119491298336733624406566430860213949463952247371907021798609437027705392171762931767523846748184676694051320005681271452635608277857713427577896091736371787214684409012249534301465495853710507922796892589235420199561121290219608640344181598136297747713099605187072113499999983729780499510597317328160963185950244594553469083026425223082533446850352619311881710100031378387528865875332083814206171776691473035982534904287554687311595628638823537875937519577818577805321712268066130019278766111959092164201989380952572010654858632789',


	  // The initial configuration properties of the Decimal constructor.
	  DEFAULTS = {

	    // These values must be integers within the stated ranges (inclusive).
	    // Most of these values can be changed at run-time using the `Decimal.config` method.

	    // The maximum number of significant digits of the result of a calculation or base conversion.
	    // E.g. `Decimal.config({ precision: 20 });`
	    precision: 20,                         // 1 to MAX_DIGITS

	    // The rounding mode used when rounding to `precision`.
	    //
	    // ROUND_UP         0 Away from zero.
	    // ROUND_DOWN       1 Towards zero.
	    // ROUND_CEIL       2 Towards +Infinity.
	    // ROUND_FLOOR      3 Towards -Infinity.
	    // ROUND_HALF_UP    4 Towards nearest neighbour. If equidistant, up.
	    // ROUND_HALF_DOWN  5 Towards nearest neighbour. If equidistant, down.
	    // ROUND_HALF_EVEN  6 Towards nearest neighbour. If equidistant, towards even neighbour.
	    // ROUND_HALF_CEIL  7 Towards nearest neighbour. If equidistant, towards +Infinity.
	    // ROUND_HALF_FLOOR 8 Towards nearest neighbour. If equidistant, towards -Infinity.
	    //
	    // E.g.
	    // `Decimal.rounding = 4;`
	    // `Decimal.rounding = Decimal.ROUND_HALF_UP;`
	    rounding: 4,                           // 0 to 8

	    // The modulo mode used when calculating the modulus: a mod n.
	    // The quotient (q = a / n) is calculated according to the corresponding rounding mode.
	    // The remainder (r) is calculated as: r = a - n * q.
	    //
	    // UP         0 The remainder is positive if the dividend is negative, else is negative.
	    // DOWN       1 The remainder has the same sign as the dividend (JavaScript %).
	    // FLOOR      3 The remainder has the same sign as the divisor (Python %).
	    // HALF_EVEN  6 The IEEE 754 remainder function.
	    // EUCLID     9 Euclidian division. q = sign(n) * floor(a / abs(n)). Always positive.
	    //
	    // Truncated division (1), floored division (3), the IEEE 754 remainder (6), and Euclidian
	    // division (9) are commonly used for the modulus operation. The other rounding modes can also
	    // be used, but they may not give useful results.
	    modulo: 1,                             // 0 to 9

	    // The exponent value at and beneath which `toString` returns exponential notation.
	    // JavaScript numbers: -7
	    toExpNeg: -7,                          // 0 to -EXP_LIMIT

	    // The exponent value at and above which `toString` returns exponential notation.
	    // JavaScript numbers: 21
	    toExpPos:  21,                         // 0 to EXP_LIMIT

	    // The minimum exponent value, beneath which underflow to zero occurs.
	    // JavaScript numbers: -324  (5e-324)
	    minE: -EXP_LIMIT,                      // -1 to -EXP_LIMIT

	    // The maximum exponent value, above which overflow to Infinity occurs.
	    // JavaScript numbers: 308  (1.7976931348623157e+308)
	    maxE: EXP_LIMIT,                       // 1 to EXP_LIMIT

	    // Whether to use cryptographically-secure random number generation, if available.
	    crypto: false                          // true/false
	  },


	// ----------------------------------- END OF EDITABLE DEFAULTS ------------------------------- //


	  inexact, quadrant,
	  external = true,

	  decimalError = '[DecimalError] ',
	  invalidArgument = decimalError + 'Invalid argument: ',
	  precisionLimitExceeded = decimalError + 'Precision limit exceeded',
	  cryptoUnavailable = decimalError + 'crypto unavailable',
	  tag = '[object Decimal]',

	  mathfloor = Math.floor,
	  mathpow = Math.pow,

	  isBinary = /^0b([01]+(\.[01]*)?|\.[01]+)(p[+-]?\d+)?$/i,
	  isHex = /^0x([0-9a-f]+(\.[0-9a-f]*)?|\.[0-9a-f]+)(p[+-]?\d+)?$/i,
	  isOctal = /^0o([0-7]+(\.[0-7]*)?|\.[0-7]+)(p[+-]?\d+)?$/i,
	  isDecimal = /^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i,

	  BASE = 1e7,
	  LOG_BASE = 7,
	  MAX_SAFE_INTEGER = 9007199254740991,

	  LN10_PRECISION = LN10.length - 1,
	  PI_PRECISION = PI.length - 1,

	  // Decimal.prototype object
	  P = { toStringTag: tag };


	// Decimal prototype methods


	/*
	 *  absoluteValue             abs
	 *  ceil
	 *  clampedTo                 clamp
	 *  comparedTo                cmp
	 *  cosine                    cos
	 *  cubeRoot                  cbrt
	 *  decimalPlaces             dp
	 *  dividedBy                 div
	 *  dividedToIntegerBy        divToInt
	 *  equals                    eq
	 *  floor
	 *  greaterThan               gt
	 *  greaterThanOrEqualTo      gte
	 *  hyperbolicCosine          cosh
	 *  hyperbolicSine            sinh
	 *  hyperbolicTangent         tanh
	 *  inverseCosine             acos
	 *  inverseHyperbolicCosine   acosh
	 *  inverseHyperbolicSine     asinh
	 *  inverseHyperbolicTangent  atanh
	 *  inverseSine               asin
	 *  inverseTangent            atan
	 *  isFinite
	 *  isInteger                 isInt
	 *  isNaN
	 *  isNegative                isNeg
	 *  isPositive                isPos
	 *  isZero
	 *  lessThan                  lt
	 *  lessThanOrEqualTo         lte
	 *  logarithm                 log
	 *  [maximum]                 [max]
	 *  [minimum]                 [min]
	 *  minus                     sub
	 *  modulo                    mod
	 *  naturalExponential        exp
	 *  naturalLogarithm          ln
	 *  negated                   neg
	 *  plus                      add
	 *  precision                 sd
	 *  round
	 *  sine                      sin
	 *  squareRoot                sqrt
	 *  tangent                   tan
	 *  times                     mul
	 *  toBinary
	 *  toDecimalPlaces           toDP
	 *  toExponential
	 *  toFixed
	 *  toFraction
	 *  toHexadecimal             toHex
	 *  toNearest
	 *  toNumber
	 *  toOctal
	 *  toPower                   pow
	 *  toPrecision
	 *  toSignificantDigits       toSD
	 *  toString
	 *  truncated                 trunc
	 *  valueOf                   toJSON
	 */


	/*
	 * Return a new Decimal whose value is the absolute value of this Decimal.
	 *
	 */
	P.absoluteValue = P.abs = function () {
	  var x = new this.constructor(this);
	  if (x.s < 0) x.s = 1;
	  return finalise(x);
	};


	/*
	 * Return a new Decimal whose value is the value of this Decimal rounded to a whole number in the
	 * direction of positive Infinity.
	 *
	 */
	P.ceil = function () {
	  return finalise(new this.constructor(this), this.e + 1, 2);
	};


	/*
	 * Return a new Decimal whose value is the value of this Decimal clamped to the range
	 * delineated by `min` and `max`.
	 *
	 * min {number|string|Decimal}
	 * max {number|string|Decimal}
	 *
	 */
	P.clampedTo = P.clamp = function (min, max) {
	  var k,
	    x = this,
	    Ctor = x.constructor;
	  min = new Ctor(min);
	  max = new Ctor(max);
	  if (!min.s || !max.s) return new Ctor(NaN);
	  if (min.gt(max)) throw Error(invalidArgument + max);
	  k = x.cmp(min);
	  return k < 0 ? min : x.cmp(max) > 0 ? max : new Ctor(x);
	};


	/*
	 * Return
	 *   1    if the value of this Decimal is greater than the value of `y`,
	 *  -1    if the value of this Decimal is less than the value of `y`,
	 *   0    if they have the same value,
	 *   NaN  if the value of either Decimal is NaN.
	 *
	 */
	P.comparedTo = P.cmp = function (y) {
	  var i, j, xdL, ydL,
	    x = this,
	    xd = x.d,
	    yd = (y = new x.constructor(y)).d,
	    xs = x.s,
	    ys = y.s;

	  // Either NaN or ±Infinity?
	  if (!xd || !yd) {
	    return !xs || !ys ? NaN : xs !== ys ? xs : xd === yd ? 0 : !xd ^ xs < 0 ? 1 : -1;
	  }

	  // Either zero?
	  if (!xd[0] || !yd[0]) return xd[0] ? xs : yd[0] ? -ys : 0;

	  // Signs differ?
	  if (xs !== ys) return xs;

	  // Compare exponents.
	  if (x.e !== y.e) return x.e > y.e ^ xs < 0 ? 1 : -1;

	  xdL = xd.length;
	  ydL = yd.length;

	  // Compare digit by digit.
	  for (i = 0, j = xdL < ydL ? xdL : ydL; i < j; ++i) {
	    if (xd[i] !== yd[i]) return xd[i] > yd[i] ^ xs < 0 ? 1 : -1;
	  }

	  // Compare lengths.
	  return xdL === ydL ? 0 : xdL > ydL ^ xs < 0 ? 1 : -1;
	};


	/*
	 * Return a new Decimal whose value is the cosine of the value in radians of this Decimal.
	 *
	 * Domain: [-Infinity, Infinity]
	 * Range: [-1, 1]
	 *
	 * cos(0)         = 1
	 * cos(-0)        = 1
	 * cos(Infinity)  = NaN
	 * cos(-Infinity) = NaN
	 * cos(NaN)       = NaN
	 *
	 */
	P.cosine = P.cos = function () {
	  var pr, rm,
	    x = this,
	    Ctor = x.constructor;

	  if (!x.d) return new Ctor(NaN);

	  // cos(0) = cos(-0) = 1
	  if (!x.d[0]) return new Ctor(1);

	  pr = Ctor.precision;
	  rm = Ctor.rounding;
	  Ctor.precision = pr + Math.max(x.e, x.sd()) + LOG_BASE;
	  Ctor.rounding = 1;

	  x = cosine(Ctor, toLessThanHalfPi(Ctor, x));

	  Ctor.precision = pr;
	  Ctor.rounding = rm;

	  return finalise(quadrant == 2 || quadrant == 3 ? x.neg() : x, pr, rm, true);
	};


	/*
	 *
	 * Return a new Decimal whose value is the cube root of the value of this Decimal, rounded to
	 * `precision` significant digits using rounding mode `rounding`.
	 *
	 *  cbrt(0)  =  0
	 *  cbrt(-0) = -0
	 *  cbrt(1)  =  1
	 *  cbrt(-1) = -1
	 *  cbrt(N)  =  N
	 *  cbrt(-I) = -I
	 *  cbrt(I)  =  I
	 *
	 * Math.cbrt(x) = (x < 0 ? -Math.pow(-x, 1/3) : Math.pow(x, 1/3))
	 *
	 */
	P.cubeRoot = P.cbrt = function () {
	  var e, m, n, r, rep, s, sd, t, t3, t3plusx,
	    x = this,
	    Ctor = x.constructor;

	  if (!x.isFinite() || x.isZero()) return new Ctor(x);
	  external = false;

	  // Initial estimate.
	  s = x.s * mathpow(x.s * x, 1 / 3);

	   // Math.cbrt underflow/overflow?
	   // Pass x to Math.pow as integer, then adjust the exponent of the result.
	  if (!s || Math.abs(s) == 1 / 0) {
	    n = digitsToString(x.d);
	    e = x.e;

	    // Adjust n exponent so it is a multiple of 3 away from x exponent.
	    if (s = (e - n.length + 1) % 3) n += (s == 1 || s == -2 ? '0' : '00');
	    s = mathpow(n, 1 / 3);

	    // Rarely, e may be one less than the result exponent value.
	    e = mathfloor((e + 1) / 3) - (e % 3 == (e < 0 ? -1 : 2));

	    if (s == 1 / 0) {
	      n = '5e' + e;
	    } else {
	      n = s.toExponential();
	      n = n.slice(0, n.indexOf('e') + 1) + e;
	    }

	    r = new Ctor(n);
	    r.s = x.s;
	  } else {
	    r = new Ctor(s.toString());
	  }

	  sd = (e = Ctor.precision) + 3;

	  // Halley's method.
	  // TODO? Compare Newton's method.
	  for (;;) {
	    t = r;
	    t3 = t.times(t).times(t);
	    t3plusx = t3.plus(x);
	    r = divide(t3plusx.plus(x).times(t), t3plusx.plus(t3), sd + 2, 1);

	    // TODO? Replace with for-loop and checkRoundingDigits.
	    if (digitsToString(t.d).slice(0, sd) === (n = digitsToString(r.d)).slice(0, sd)) {
	      n = n.slice(sd - 3, sd + 1);

	      // The 4th rounding digit may be in error by -1 so if the 4 rounding digits are 9999 or 4999
	      // , i.e. approaching a rounding boundary, continue the iteration.
	      if (n == '9999' || !rep && n == '4999') {

	        // On the first iteration only, check to see if rounding up gives the exact result as the
	        // nines may infinitely repeat.
	        if (!rep) {
	          finalise(t, e + 1, 0);

	          if (t.times(t).times(t).eq(x)) {
	            r = t;
	            break;
	          }
	        }

	        sd += 4;
	        rep = 1;
	      } else {

	        // If the rounding digits are null, 0{0,4} or 50{0,3}, check for an exact result.
	        // If not, then there are further digits and m will be truthy.
	        if (!+n || !+n.slice(1) && n.charAt(0) == '5') {

	          // Truncate to the first rounding digit.
	          finalise(r, e + 1, 1);
	          m = !r.times(r).times(r).eq(x);
	        }

	        break;
	      }
	    }
	  }

	  external = true;

	  return finalise(r, e, Ctor.rounding, m);
	};


	/*
	 * Return the number of decimal places of the value of this Decimal.
	 *
	 */
	P.decimalPlaces = P.dp = function () {
	  var w,
	    d = this.d,
	    n = NaN;

	  if (d) {
	    w = d.length - 1;
	    n = (w - mathfloor(this.e / LOG_BASE)) * LOG_BASE;

	    // Subtract the number of trailing zeros of the last word.
	    w = d[w];
	    if (w) for (; w % 10 == 0; w /= 10) n--;
	    if (n < 0) n = 0;
	  }

	  return n;
	};


	/*
	 *  n / 0 = I
	 *  n / N = N
	 *  n / I = 0
	 *  0 / n = 0
	 *  0 / 0 = N
	 *  0 / N = N
	 *  0 / I = 0
	 *  N / n = N
	 *  N / 0 = N
	 *  N / N = N
	 *  N / I = N
	 *  I / n = I
	 *  I / 0 = I
	 *  I / N = N
	 *  I / I = N
	 *
	 * Return a new Decimal whose value is the value of this Decimal divided by `y`, rounded to
	 * `precision` significant digits using rounding mode `rounding`.
	 *
	 */
	P.dividedBy = P.div = function (y) {
	  return divide(this, new this.constructor(y));
	};


	/*
	 * Return a new Decimal whose value is the integer part of dividing the value of this Decimal
	 * by the value of `y`, rounded to `precision` significant digits using rounding mode `rounding`.
	 *
	 */
	P.dividedToIntegerBy = P.divToInt = function (y) {
	  var x = this,
	    Ctor = x.constructor;
	  return finalise(divide(x, new Ctor(y), 0, 1, 1), Ctor.precision, Ctor.rounding);
	};


	/*
	 * Return true if the value of this Decimal is equal to the value of `y`, otherwise return false.
	 *
	 */
	P.equals = P.eq = function (y) {
	  return this.cmp(y) === 0;
	};


	/*
	 * Return a new Decimal whose value is the value of this Decimal rounded to a whole number in the
	 * direction of negative Infinity.
	 *
	 */
	P.floor = function () {
	  return finalise(new this.constructor(this), this.e + 1, 3);
	};


	/*
	 * Return true if the value of this Decimal is greater than the value of `y`, otherwise return
	 * false.
	 *
	 */
	P.greaterThan = P.gt = function (y) {
	  return this.cmp(y) > 0;
	};


	/*
	 * Return true if the value of this Decimal is greater than or equal to the value of `y`,
	 * otherwise return false.
	 *
	 */
	P.greaterThanOrEqualTo = P.gte = function (y) {
	  var k = this.cmp(y);
	  return k == 1 || k === 0;
	};


	/*
	 * Return a new Decimal whose value is the hyperbolic cosine of the value in radians of this
	 * Decimal.
	 *
	 * Domain: [-Infinity, Infinity]
	 * Range: [1, Infinity]
	 *
	 * cosh(x) = 1 + x^2/2! + x^4/4! + x^6/6! + ...
	 *
	 * cosh(0)         = 1
	 * cosh(-0)        = 1
	 * cosh(Infinity)  = Infinity
	 * cosh(-Infinity) = Infinity
	 * cosh(NaN)       = NaN
	 *
	 *  x        time taken (ms)   result
	 * 1000      9                 9.8503555700852349694e+433
	 * 10000     25                4.4034091128314607936e+4342
	 * 100000    171               1.4033316802130615897e+43429
	 * 1000000   3817              1.5166076984010437725e+434294
	 * 10000000  abandoned after 2 minute wait
	 *
	 * TODO? Compare performance of cosh(x) = 0.5 * (exp(x) + exp(-x))
	 *
	 */
	P.hyperbolicCosine = P.cosh = function () {
	  var k, n, pr, rm, len,
	    x = this,
	    Ctor = x.constructor,
	    one = new Ctor(1);

	  if (!x.isFinite()) return new Ctor(x.s ? 1 / 0 : NaN);
	  if (x.isZero()) return one;

	  pr = Ctor.precision;
	  rm = Ctor.rounding;
	  Ctor.precision = pr + Math.max(x.e, x.sd()) + 4;
	  Ctor.rounding = 1;
	  len = x.d.length;

	  // Argument reduction: cos(4x) = 1 - 8cos^2(x) + 8cos^4(x) + 1
	  // i.e. cos(x) = 1 - cos^2(x/4)(8 - 8cos^2(x/4))

	  // Estimate the optimum number of times to use the argument reduction.
	  // TODO? Estimation reused from cosine() and may not be optimal here.
	  if (len < 32) {
	    k = Math.ceil(len / 3);
	    n = (1 / tinyPow(4, k)).toString();
	  } else {
	    k = 16;
	    n = '2.3283064365386962890625e-10';
	  }

	  x = taylorSeries(Ctor, 1, x.times(n), new Ctor(1), true);

	  // Reverse argument reduction
	  var cosh2_x,
	    i = k,
	    d8 = new Ctor(8);
	  for (; i--;) {
	    cosh2_x = x.times(x);
	    x = one.minus(cosh2_x.times(d8.minus(cosh2_x.times(d8))));
	  }

	  return finalise(x, Ctor.precision = pr, Ctor.rounding = rm, true);
	};


	/*
	 * Return a new Decimal whose value is the hyperbolic sine of the value in radians of this
	 * Decimal.
	 *
	 * Domain: [-Infinity, Infinity]
	 * Range: [-Infinity, Infinity]
	 *
	 * sinh(x) = x + x^3/3! + x^5/5! + x^7/7! + ...
	 *
	 * sinh(0)         = 0
	 * sinh(-0)        = -0
	 * sinh(Infinity)  = Infinity
	 * sinh(-Infinity) = -Infinity
	 * sinh(NaN)       = NaN
	 *
	 * x        time taken (ms)
	 * 10       2 ms
	 * 100      5 ms
	 * 1000     14 ms
	 * 10000    82 ms
	 * 100000   886 ms            1.4033316802130615897e+43429
	 * 200000   2613 ms
	 * 300000   5407 ms
	 * 400000   8824 ms
	 * 500000   13026 ms          8.7080643612718084129e+217146
	 * 1000000  48543 ms
	 *
	 * TODO? Compare performance of sinh(x) = 0.5 * (exp(x) - exp(-x))
	 *
	 */
	P.hyperbolicSine = P.sinh = function () {
	  var k, pr, rm, len,
	    x = this,
	    Ctor = x.constructor;

	  if (!x.isFinite() || x.isZero()) return new Ctor(x);

	  pr = Ctor.precision;
	  rm = Ctor.rounding;
	  Ctor.precision = pr + Math.max(x.e, x.sd()) + 4;
	  Ctor.rounding = 1;
	  len = x.d.length;

	  if (len < 3) {
	    x = taylorSeries(Ctor, 2, x, x, true);
	  } else {

	    // Alternative argument reduction: sinh(3x) = sinh(x)(3 + 4sinh^2(x))
	    // i.e. sinh(x) = sinh(x/3)(3 + 4sinh^2(x/3))
	    // 3 multiplications and 1 addition

	    // Argument reduction: sinh(5x) = sinh(x)(5 + sinh^2(x)(20 + 16sinh^2(x)))
	    // i.e. sinh(x) = sinh(x/5)(5 + sinh^2(x/5)(20 + 16sinh^2(x/5)))
	    // 4 multiplications and 2 additions

	    // Estimate the optimum number of times to use the argument reduction.
	    k = 1.4 * Math.sqrt(len);
	    k = k > 16 ? 16 : k | 0;

	    x = x.times(1 / tinyPow(5, k));
	    x = taylorSeries(Ctor, 2, x, x, true);

	    // Reverse argument reduction
	    var sinh2_x,
	      d5 = new Ctor(5),
	      d16 = new Ctor(16),
	      d20 = new Ctor(20);
	    for (; k--;) {
	      sinh2_x = x.times(x);
	      x = x.times(d5.plus(sinh2_x.times(d16.times(sinh2_x).plus(d20))));
	    }
	  }

	  Ctor.precision = pr;
	  Ctor.rounding = rm;

	  return finalise(x, pr, rm, true);
	};


	/*
	 * Return a new Decimal whose value is the hyperbolic tangent of the value in radians of this
	 * Decimal.
	 *
	 * Domain: [-Infinity, Infinity]
	 * Range: [-1, 1]
	 *
	 * tanh(x) = sinh(x) / cosh(x)
	 *
	 * tanh(0)         = 0
	 * tanh(-0)        = -0
	 * tanh(Infinity)  = 1
	 * tanh(-Infinity) = -1
	 * tanh(NaN)       = NaN
	 *
	 */
	P.hyperbolicTangent = P.tanh = function () {
	  var pr, rm,
	    x = this,
	    Ctor = x.constructor;

	  if (!x.isFinite()) return new Ctor(x.s);
	  if (x.isZero()) return new Ctor(x);

	  pr = Ctor.precision;
	  rm = Ctor.rounding;
	  Ctor.precision = pr + 7;
	  Ctor.rounding = 1;

	  return divide(x.sinh(), x.cosh(), Ctor.precision = pr, Ctor.rounding = rm);
	};


	/*
	 * Return a new Decimal whose value is the arccosine (inverse cosine) in radians of the value of
	 * this Decimal.
	 *
	 * Domain: [-1, 1]
	 * Range: [0, pi]
	 *
	 * acos(x) = pi/2 - asin(x)
	 *
	 * acos(0)       = pi/2
	 * acos(-0)      = pi/2
	 * acos(1)       = 0
	 * acos(-1)      = pi
	 * acos(1/2)     = pi/3
	 * acos(-1/2)    = 2*pi/3
	 * acos(|x| > 1) = NaN
	 * acos(NaN)     = NaN
	 *
	 */
	P.inverseCosine = P.acos = function () {
	  var halfPi,
	    x = this,
	    Ctor = x.constructor,
	    k = x.abs().cmp(1),
	    pr = Ctor.precision,
	    rm = Ctor.rounding;

	  if (k !== -1) {
	    return k === 0
	      // |x| is 1
	      ? x.isNeg() ? getPi(Ctor, pr, rm) : new Ctor(0)
	      // |x| > 1 or x is NaN
	      : new Ctor(NaN);
	  }

	  if (x.isZero()) return getPi(Ctor, pr + 4, rm).times(0.5);

	  // TODO? Special case acos(0.5) = pi/3 and acos(-0.5) = 2*pi/3

	  Ctor.precision = pr + 6;
	  Ctor.rounding = 1;

	  x = x.asin();
	  halfPi = getPi(Ctor, pr + 4, rm).times(0.5);

	  Ctor.precision = pr;
	  Ctor.rounding = rm;

	  return halfPi.minus(x);
	};


	/*
	 * Return a new Decimal whose value is the inverse of the hyperbolic cosine in radians of the
	 * value of this Decimal.
	 *
	 * Domain: [1, Infinity]
	 * Range: [0, Infinity]
	 *
	 * acosh(x) = ln(x + sqrt(x^2 - 1))
	 *
	 * acosh(x < 1)     = NaN
	 * acosh(NaN)       = NaN
	 * acosh(Infinity)  = Infinity
	 * acosh(-Infinity) = NaN
	 * acosh(0)         = NaN
	 * acosh(-0)        = NaN
	 * acosh(1)         = 0
	 * acosh(-1)        = NaN
	 *
	 */
	P.inverseHyperbolicCosine = P.acosh = function () {
	  var pr, rm,
	    x = this,
	    Ctor = x.constructor;

	  if (x.lte(1)) return new Ctor(x.eq(1) ? 0 : NaN);
	  if (!x.isFinite()) return new Ctor(x);

	  pr = Ctor.precision;
	  rm = Ctor.rounding;
	  Ctor.precision = pr + Math.max(Math.abs(x.e), x.sd()) + 4;
	  Ctor.rounding = 1;
	  external = false;

	  x = x.times(x).minus(1).sqrt().plus(x);

	  external = true;
	  Ctor.precision = pr;
	  Ctor.rounding = rm;

	  return x.ln();
	};


	/*
	 * Return a new Decimal whose value is the inverse of the hyperbolic sine in radians of the value
	 * of this Decimal.
	 *
	 * Domain: [-Infinity, Infinity]
	 * Range: [-Infinity, Infinity]
	 *
	 * asinh(x) = ln(x + sqrt(x^2 + 1))
	 *
	 * asinh(NaN)       = NaN
	 * asinh(Infinity)  = Infinity
	 * asinh(-Infinity) = -Infinity
	 * asinh(0)         = 0
	 * asinh(-0)        = -0
	 *
	 */
	P.inverseHyperbolicSine = P.asinh = function () {
	  var pr, rm,
	    x = this,
	    Ctor = x.constructor;

	  if (!x.isFinite() || x.isZero()) return new Ctor(x);

	  pr = Ctor.precision;
	  rm = Ctor.rounding;
	  Ctor.precision = pr + 2 * Math.max(Math.abs(x.e), x.sd()) + 6;
	  Ctor.rounding = 1;
	  external = false;

	  x = x.times(x).plus(1).sqrt().plus(x);

	  external = true;
	  Ctor.precision = pr;
	  Ctor.rounding = rm;

	  return x.ln();
	};


	/*
	 * Return a new Decimal whose value is the inverse of the hyperbolic tangent in radians of the
	 * value of this Decimal.
	 *
	 * Domain: [-1, 1]
	 * Range: [-Infinity, Infinity]
	 *
	 * atanh(x) = 0.5 * ln((1 + x) / (1 - x))
	 *
	 * atanh(|x| > 1)   = NaN
	 * atanh(NaN)       = NaN
	 * atanh(Infinity)  = NaN
	 * atanh(-Infinity) = NaN
	 * atanh(0)         = 0
	 * atanh(-0)        = -0
	 * atanh(1)         = Infinity
	 * atanh(-1)        = -Infinity
	 *
	 */
	P.inverseHyperbolicTangent = P.atanh = function () {
	  var pr, rm, wpr, xsd,
	    x = this,
	    Ctor = x.constructor;

	  if (!x.isFinite()) return new Ctor(NaN);
	  if (x.e >= 0) return new Ctor(x.abs().eq(1) ? x.s / 0 : x.isZero() ? x : NaN);

	  pr = Ctor.precision;
	  rm = Ctor.rounding;
	  xsd = x.sd();

	  if (Math.max(xsd, pr) < 2 * -x.e - 1) return finalise(new Ctor(x), pr, rm, true);

	  Ctor.precision = wpr = xsd - x.e;

	  x = divide(x.plus(1), new Ctor(1).minus(x), wpr + pr, 1);

	  Ctor.precision = pr + 4;
	  Ctor.rounding = 1;

	  x = x.ln();

	  Ctor.precision = pr;
	  Ctor.rounding = rm;

	  return x.times(0.5);
	};


	/*
	 * Return a new Decimal whose value is the arcsine (inverse sine) in radians of the value of this
	 * Decimal.
	 *
	 * Domain: [-Infinity, Infinity]
	 * Range: [-pi/2, pi/2]
	 *
	 * asin(x) = 2*atan(x/(1 + sqrt(1 - x^2)))
	 *
	 * asin(0)       = 0
	 * asin(-0)      = -0
	 * asin(1/2)     = pi/6
	 * asin(-1/2)    = -pi/6
	 * asin(1)       = pi/2
	 * asin(-1)      = -pi/2
	 * asin(|x| > 1) = NaN
	 * asin(NaN)     = NaN
	 *
	 * TODO? Compare performance of Taylor series.
	 *
	 */
	P.inverseSine = P.asin = function () {
	  var halfPi, k,
	    pr, rm,
	    x = this,
	    Ctor = x.constructor;

	  if (x.isZero()) return new Ctor(x);

	  k = x.abs().cmp(1);
	  pr = Ctor.precision;
	  rm = Ctor.rounding;

	  if (k !== -1) {

	    // |x| is 1
	    if (k === 0) {
	      halfPi = getPi(Ctor, pr + 4, rm).times(0.5);
	      halfPi.s = x.s;
	      return halfPi;
	    }

	    // |x| > 1 or x is NaN
	    return new Ctor(NaN);
	  }

	  // TODO? Special case asin(1/2) = pi/6 and asin(-1/2) = -pi/6

	  Ctor.precision = pr + 6;
	  Ctor.rounding = 1;

	  x = x.div(new Ctor(1).minus(x.times(x)).sqrt().plus(1)).atan();

	  Ctor.precision = pr;
	  Ctor.rounding = rm;

	  return x.times(2);
	};


	/*
	 * Return a new Decimal whose value is the arctangent (inverse tangent) in radians of the value
	 * of this Decimal.
	 *
	 * Domain: [-Infinity, Infinity]
	 * Range: [-pi/2, pi/2]
	 *
	 * atan(x) = x - x^3/3 + x^5/5 - x^7/7 + ...
	 *
	 * atan(0)         = 0
	 * atan(-0)        = -0
	 * atan(1)         = pi/4
	 * atan(-1)        = -pi/4
	 * atan(Infinity)  = pi/2
	 * atan(-Infinity) = -pi/2
	 * atan(NaN)       = NaN
	 *
	 */
	P.inverseTangent = P.atan = function () {
	  var i, j, k, n, px, t, r, wpr, x2,
	    x = this,
	    Ctor = x.constructor,
	    pr = Ctor.precision,
	    rm = Ctor.rounding;

	  if (!x.isFinite()) {
	    if (!x.s) return new Ctor(NaN);
	    if (pr + 4 <= PI_PRECISION) {
	      r = getPi(Ctor, pr + 4, rm).times(0.5);
	      r.s = x.s;
	      return r;
	    }
	  } else if (x.isZero()) {
	    return new Ctor(x);
	  } else if (x.abs().eq(1) && pr + 4 <= PI_PRECISION) {
	    r = getPi(Ctor, pr + 4, rm).times(0.25);
	    r.s = x.s;
	    return r;
	  }

	  Ctor.precision = wpr = pr + 10;
	  Ctor.rounding = 1;

	  // TODO? if (x >= 1 && pr <= PI_PRECISION) atan(x) = halfPi * x.s - atan(1 / x);

	  // Argument reduction
	  // Ensure |x| < 0.42
	  // atan(x) = 2 * atan(x / (1 + sqrt(1 + x^2)))

	  k = Math.min(28, wpr / LOG_BASE + 2 | 0);

	  for (i = k; i; --i) x = x.div(x.times(x).plus(1).sqrt().plus(1));

	  external = false;

	  j = Math.ceil(wpr / LOG_BASE);
	  n = 1;
	  x2 = x.times(x);
	  r = new Ctor(x);
	  px = x;

	  // atan(x) = x - x^3/3 + x^5/5 - x^7/7 + ...
	  for (; i !== -1;) {
	    px = px.times(x2);
	    t = r.minus(px.div(n += 2));

	    px = px.times(x2);
	    r = t.plus(px.div(n += 2));

	    if (r.d[j] !== void 0) for (i = j; r.d[i] === t.d[i] && i--;);
	  }

	  if (k) r = r.times(2 << (k - 1));

	  external = true;

	  return finalise(r, Ctor.precision = pr, Ctor.rounding = rm, true);
	};


	/*
	 * Return true if the value of this Decimal is a finite number, otherwise return false.
	 *
	 */
	P.isFinite = function () {
	  return !!this.d;
	};


	/*
	 * Return true if the value of this Decimal is an integer, otherwise return false.
	 *
	 */
	P.isInteger = P.isInt = function () {
	  return !!this.d && mathfloor(this.e / LOG_BASE) > this.d.length - 2;
	};


	/*
	 * Return true if the value of this Decimal is NaN, otherwise return false.
	 *
	 */
	P.isNaN = function () {
	  return !this.s;
	};


	/*
	 * Return true if the value of this Decimal is negative, otherwise return false.
	 *
	 */
	P.isNegative = P.isNeg = function () {
	  return this.s < 0;
	};


	/*
	 * Return true if the value of this Decimal is positive, otherwise return false.
	 *
	 */
	P.isPositive = P.isPos = function () {
	  return this.s > 0;
	};


	/*
	 * Return true if the value of this Decimal is 0 or -0, otherwise return false.
	 *
	 */
	P.isZero = function () {
	  return !!this.d && this.d[0] === 0;
	};


	/*
	 * Return true if the value of this Decimal is less than `y`, otherwise return false.
	 *
	 */
	P.lessThan = P.lt = function (y) {
	  return this.cmp(y) < 0;
	};


	/*
	 * Return true if the value of this Decimal is less than or equal to `y`, otherwise return false.
	 *
	 */
	P.lessThanOrEqualTo = P.lte = function (y) {
	  return this.cmp(y) < 1;
	};


	/*
	 * Return the logarithm of the value of this Decimal to the specified base, rounded to `precision`
	 * significant digits using rounding mode `rounding`.
	 *
	 * If no base is specified, return log[10](arg).
	 *
	 * log[base](arg) = ln(arg) / ln(base)
	 *
	 * The result will always be correctly rounded if the base of the log is 10, and 'almost always'
	 * otherwise:
	 *
	 * Depending on the rounding mode, the result may be incorrectly rounded if the first fifteen
	 * rounding digits are [49]99999999999999 or [50]00000000000000. In that case, the maximum error
	 * between the result and the correctly rounded result will be one ulp (unit in the last place).
	 *
	 * log[-b](a)       = NaN
	 * log[0](a)        = NaN
	 * log[1](a)        = NaN
	 * log[NaN](a)      = NaN
	 * log[Infinity](a) = NaN
	 * log[b](0)        = -Infinity
	 * log[b](-0)       = -Infinity
	 * log[b](-a)       = NaN
	 * log[b](1)        = 0
	 * log[b](Infinity) = Infinity
	 * log[b](NaN)      = NaN
	 *
	 * [base] {number|string|Decimal} The base of the logarithm.
	 *
	 */
	P.logarithm = P.log = function (base) {
	  var isBase10, d, denominator, k, inf, num, sd, r,
	    arg = this,
	    Ctor = arg.constructor,
	    pr = Ctor.precision,
	    rm = Ctor.rounding,
	    guard = 5;

	  // Default base is 10.
	  if (base == null) {
	    base = new Ctor(10);
	    isBase10 = true;
	  } else {
	    base = new Ctor(base);
	    d = base.d;

	    // Return NaN if base is negative, or non-finite, or is 0 or 1.
	    if (base.s < 0 || !d || !d[0] || base.eq(1)) return new Ctor(NaN);

	    isBase10 = base.eq(10);
	  }

	  d = arg.d;

	  // Is arg negative, non-finite, 0 or 1?
	  if (arg.s < 0 || !d || !d[0] || arg.eq(1)) {
	    return new Ctor(d && !d[0] ? -1 / 0 : arg.s != 1 ? NaN : d ? 0 : 1 / 0);
	  }

	  // The result will have a non-terminating decimal expansion if base is 10 and arg is not an
	  // integer power of 10.
	  if (isBase10) {
	    if (d.length > 1) {
	      inf = true;
	    } else {
	      for (k = d[0]; k % 10 === 0;) k /= 10;
	      inf = k !== 1;
	    }
	  }

	  external = false;
	  sd = pr + guard;
	  num = naturalLogarithm(arg, sd);
	  denominator = isBase10 ? getLn10(Ctor, sd + 10) : naturalLogarithm(base, sd);

	  // The result will have 5 rounding digits.
	  r = divide(num, denominator, sd, 1);

	  // If at a rounding boundary, i.e. the result's rounding digits are [49]9999 or [50]0000,
	  // calculate 10 further digits.
	  //
	  // If the result is known to have an infinite decimal expansion, repeat this until it is clear
	  // that the result is above or below the boundary. Otherwise, if after calculating the 10
	  // further digits, the last 14 are nines, round up and assume the result is exact.
	  // Also assume the result is exact if the last 14 are zero.
	  //
	  // Example of a result that will be incorrectly rounded:
	  // log[1048576](4503599627370502) = 2.60000000000000009610279511444746...
	  // The above result correctly rounded using ROUND_CEIL to 1 decimal place should be 2.7, but it
	  // will be given as 2.6 as there are 15 zeros immediately after the requested decimal place, so
	  // the exact result would be assumed to be 2.6, which rounded using ROUND_CEIL to 1 decimal
	  // place is still 2.6.
	  if (checkRoundingDigits(r.d, k = pr, rm)) {

	    do {
	      sd += 10;
	      num = naturalLogarithm(arg, sd);
	      denominator = isBase10 ? getLn10(Ctor, sd + 10) : naturalLogarithm(base, sd);
	      r = divide(num, denominator, sd, 1);

	      if (!inf) {

	        // Check for 14 nines from the 2nd rounding digit, as the first may be 4.
	        if (+digitsToString(r.d).slice(k + 1, k + 15) + 1 == 1e14) {
	          r = finalise(r, pr + 1, 0);
	        }

	        break;
	      }
	    } while (checkRoundingDigits(r.d, k += 10, rm));
	  }

	  external = true;

	  return finalise(r, pr, rm);
	};


	/*
	 * Return a new Decimal whose value is the maximum of the arguments and the value of this Decimal.
	 *
	 * arguments {number|string|Decimal}
	 *
	P.max = function () {
	  Array.prototype.push.call(arguments, this);
	  return maxOrMin(this.constructor, arguments, 'lt');
	};
	 */


	/*
	 * Return a new Decimal whose value is the minimum of the arguments and the value of this Decimal.
	 *
	 * arguments {number|string|Decimal}
	 *
	P.min = function () {
	  Array.prototype.push.call(arguments, this);
	  return maxOrMin(this.constructor, arguments, 'gt');
	};
	 */


	/*
	 *  n - 0 = n
	 *  n - N = N
	 *  n - I = -I
	 *  0 - n = -n
	 *  0 - 0 = 0
	 *  0 - N = N
	 *  0 - I = -I
	 *  N - n = N
	 *  N - 0 = N
	 *  N - N = N
	 *  N - I = N
	 *  I - n = I
	 *  I - 0 = I
	 *  I - N = N
	 *  I - I = N
	 *
	 * Return a new Decimal whose value is the value of this Decimal minus `y`, rounded to `precision`
	 * significant digits using rounding mode `rounding`.
	 *
	 */
	P.minus = P.sub = function (y) {
	  var d, e, i, j, k, len, pr, rm, xd, xe, xLTy, yd,
	    x = this,
	    Ctor = x.constructor;

	  y = new Ctor(y);

	  // If either is not finite...
	  if (!x.d || !y.d) {

	    // Return NaN if either is NaN.
	    if (!x.s || !y.s) y = new Ctor(NaN);

	    // Return y negated if x is finite and y is ±Infinity.
	    else if (x.d) y.s = -y.s;

	    // Return x if y is finite and x is ±Infinity.
	    // Return x if both are ±Infinity with different signs.
	    // Return NaN if both are ±Infinity with the same sign.
	    else y = new Ctor(y.d || x.s !== y.s ? x : NaN);

	    return y;
	  }

	  // If signs differ...
	  if (x.s != y.s) {
	    y.s = -y.s;
	    return x.plus(y);
	  }

	  xd = x.d;
	  yd = y.d;
	  pr = Ctor.precision;
	  rm = Ctor.rounding;

	  // If either is zero...
	  if (!xd[0] || !yd[0]) {

	    // Return y negated if x is zero and y is non-zero.
	    if (yd[0]) y.s = -y.s;

	    // Return x if y is zero and x is non-zero.
	    else if (xd[0]) y = new Ctor(x);

	    // Return zero if both are zero.
	    // From IEEE 754 (2008) 6.3: 0 - 0 = -0 - -0 = -0 when rounding to -Infinity.
	    else return new Ctor(rm === 3 ? -0 : 0);

	    return external ? finalise(y, pr, rm) : y;
	  }

	  // x and y are finite, non-zero numbers with the same sign.

	  // Calculate base 1e7 exponents.
	  e = mathfloor(y.e / LOG_BASE);
	  xe = mathfloor(x.e / LOG_BASE);

	  xd = xd.slice();
	  k = xe - e;

	  // If base 1e7 exponents differ...
	  if (k) {
	    xLTy = k < 0;

	    if (xLTy) {
	      d = xd;
	      k = -k;
	      len = yd.length;
	    } else {
	      d = yd;
	      e = xe;
	      len = xd.length;
	    }

	    // Numbers with massively different exponents would result in a very high number of
	    // zeros needing to be prepended, but this can be avoided while still ensuring correct
	    // rounding by limiting the number of zeros to `Math.ceil(pr / LOG_BASE) + 2`.
	    i = Math.max(Math.ceil(pr / LOG_BASE), len) + 2;

	    if (k > i) {
	      k = i;
	      d.length = 1;
	    }

	    // Prepend zeros to equalise exponents.
	    d.reverse();
	    for (i = k; i--;) d.push(0);
	    d.reverse();

	  // Base 1e7 exponents equal.
	  } else {

	    // Check digits to determine which is the bigger number.

	    i = xd.length;
	    len = yd.length;
	    xLTy = i < len;
	    if (xLTy) len = i;

	    for (i = 0; i < len; i++) {
	      if (xd[i] != yd[i]) {
	        xLTy = xd[i] < yd[i];
	        break;
	      }
	    }

	    k = 0;
	  }

	  if (xLTy) {
	    d = xd;
	    xd = yd;
	    yd = d;
	    y.s = -y.s;
	  }

	  len = xd.length;

	  // Append zeros to `xd` if shorter.
	  // Don't add zeros to `yd` if shorter as subtraction only needs to start at `yd` length.
	  for (i = yd.length - len; i > 0; --i) xd[len++] = 0;

	  // Subtract yd from xd.
	  for (i = yd.length; i > k;) {

	    if (xd[--i] < yd[i]) {
	      for (j = i; j && xd[--j] === 0;) xd[j] = BASE - 1;
	      --xd[j];
	      xd[i] += BASE;
	    }

	    xd[i] -= yd[i];
	  }

	  // Remove trailing zeros.
	  for (; xd[--len] === 0;) xd.pop();

	  // Remove leading zeros and adjust exponent accordingly.
	  for (; xd[0] === 0; xd.shift()) --e;

	  // Zero?
	  if (!xd[0]) return new Ctor(rm === 3 ? -0 : 0);

	  y.d = xd;
	  y.e = getBase10Exponent(xd, e);

	  return external ? finalise(y, pr, rm) : y;
	};


	/*
	 *   n % 0 =  N
	 *   n % N =  N
	 *   n % I =  n
	 *   0 % n =  0
	 *  -0 % n = -0
	 *   0 % 0 =  N
	 *   0 % N =  N
	 *   0 % I =  0
	 *   N % n =  N
	 *   N % 0 =  N
	 *   N % N =  N
	 *   N % I =  N
	 *   I % n =  N
	 *   I % 0 =  N
	 *   I % N =  N
	 *   I % I =  N
	 *
	 * Return a new Decimal whose value is the value of this Decimal modulo `y`, rounded to
	 * `precision` significant digits using rounding mode `rounding`.
	 *
	 * The result depends on the modulo mode.
	 *
	 */
	P.modulo = P.mod = function (y) {
	  var q,
	    x = this,
	    Ctor = x.constructor;

	  y = new Ctor(y);

	  // Return NaN if x is ±Infinity or NaN, or y is NaN or ±0.
	  if (!x.d || !y.s || y.d && !y.d[0]) return new Ctor(NaN);

	  // Return x if y is ±Infinity or x is ±0.
	  if (!y.d || x.d && !x.d[0]) {
	    return finalise(new Ctor(x), Ctor.precision, Ctor.rounding);
	  }

	  // Prevent rounding of intermediate calculations.
	  external = false;

	  if (Ctor.modulo == 9) {

	    // Euclidian division: q = sign(y) * floor(x / abs(y))
	    // result = x - q * y    where  0 <= result < abs(y)
	    q = divide(x, y.abs(), 0, 3, 1);
	    q.s *= y.s;
	  } else {
	    q = divide(x, y, 0, Ctor.modulo, 1);
	  }

	  q = q.times(y);

	  external = true;

	  return x.minus(q);
	};


	/*
	 * Return a new Decimal whose value is the natural exponential of the value of this Decimal,
	 * i.e. the base e raised to the power the value of this Decimal, rounded to `precision`
	 * significant digits using rounding mode `rounding`.
	 *
	 */
	P.naturalExponential = P.exp = function () {
	  return naturalExponential(this);
	};


	/*
	 * Return a new Decimal whose value is the natural logarithm of the value of this Decimal,
	 * rounded to `precision` significant digits using rounding mode `rounding`.
	 *
	 */
	P.naturalLogarithm = P.ln = function () {
	  return naturalLogarithm(this);
	};


	/*
	 * Return a new Decimal whose value is the value of this Decimal negated, i.e. as if multiplied by
	 * -1.
	 *
	 */
	P.negated = P.neg = function () {
	  var x = new this.constructor(this);
	  x.s = -x.s;
	  return finalise(x);
	};


	/*
	 *  n + 0 = n
	 *  n + N = N
	 *  n + I = I
	 *  0 + n = n
	 *  0 + 0 = 0
	 *  0 + N = N
	 *  0 + I = I
	 *  N + n = N
	 *  N + 0 = N
	 *  N + N = N
	 *  N + I = N
	 *  I + n = I
	 *  I + 0 = I
	 *  I + N = N
	 *  I + I = I
	 *
	 * Return a new Decimal whose value is the value of this Decimal plus `y`, rounded to `precision`
	 * significant digits using rounding mode `rounding`.
	 *
	 */
	P.plus = P.add = function (y) {
	  var carry, d, e, i, k, len, pr, rm, xd, yd,
	    x = this,
	    Ctor = x.constructor;

	  y = new Ctor(y);

	  // If either is not finite...
	  if (!x.d || !y.d) {

	    // Return NaN if either is NaN.
	    if (!x.s || !y.s) y = new Ctor(NaN);

	    // Return x if y is finite and x is ±Infinity.
	    // Return x if both are ±Infinity with the same sign.
	    // Return NaN if both are ±Infinity with different signs.
	    // Return y if x is finite and y is ±Infinity.
	    else if (!x.d) y = new Ctor(y.d || x.s === y.s ? x : NaN);

	    return y;
	  }

	   // If signs differ...
	  if (x.s != y.s) {
	    y.s = -y.s;
	    return x.minus(y);
	  }

	  xd = x.d;
	  yd = y.d;
	  pr = Ctor.precision;
	  rm = Ctor.rounding;

	  // If either is zero...
	  if (!xd[0] || !yd[0]) {

	    // Return x if y is zero.
	    // Return y if y is non-zero.
	    if (!yd[0]) y = new Ctor(x);

	    return external ? finalise(y, pr, rm) : y;
	  }

	  // x and y are finite, non-zero numbers with the same sign.

	  // Calculate base 1e7 exponents.
	  k = mathfloor(x.e / LOG_BASE);
	  e = mathfloor(y.e / LOG_BASE);

	  xd = xd.slice();
	  i = k - e;

	  // If base 1e7 exponents differ...
	  if (i) {

	    if (i < 0) {
	      d = xd;
	      i = -i;
	      len = yd.length;
	    } else {
	      d = yd;
	      e = k;
	      len = xd.length;
	    }

	    // Limit number of zeros prepended to max(ceil(pr / LOG_BASE), len) + 1.
	    k = Math.ceil(pr / LOG_BASE);
	    len = k > len ? k + 1 : len + 1;

	    if (i > len) {
	      i = len;
	      d.length = 1;
	    }

	    // Prepend zeros to equalise exponents. Note: Faster to use reverse then do unshifts.
	    d.reverse();
	    for (; i--;) d.push(0);
	    d.reverse();
	  }

	  len = xd.length;
	  i = yd.length;

	  // If yd is longer than xd, swap xd and yd so xd points to the longer array.
	  if (len - i < 0) {
	    i = len;
	    d = yd;
	    yd = xd;
	    xd = d;
	  }

	  // Only start adding at yd.length - 1 as the further digits of xd can be left as they are.
	  for (carry = 0; i;) {
	    carry = (xd[--i] = xd[i] + yd[i] + carry) / BASE | 0;
	    xd[i] %= BASE;
	  }

	  if (carry) {
	    xd.unshift(carry);
	    ++e;
	  }

	  // Remove trailing zeros.
	  // No need to check for zero, as +x + +y != 0 && -x + -y != 0
	  for (len = xd.length; xd[--len] == 0;) xd.pop();

	  y.d = xd;
	  y.e = getBase10Exponent(xd, e);

	  return external ? finalise(y, pr, rm) : y;
	};


	/*
	 * Return the number of significant digits of the value of this Decimal.
	 *
	 * [z] {boolean|number} Whether to count integer-part trailing zeros: true, false, 1 or 0.
	 *
	 */
	P.precision = P.sd = function (z) {
	  var k,
	    x = this;

	  if (z !== void 0 && z !== !!z && z !== 1 && z !== 0) throw Error(invalidArgument + z);

	  if (x.d) {
	    k = getPrecision(x.d);
	    if (z && x.e + 1 > k) k = x.e + 1;
	  } else {
	    k = NaN;
	  }

	  return k;
	};


	/*
	 * Return a new Decimal whose value is the value of this Decimal rounded to a whole number using
	 * rounding mode `rounding`.
	 *
	 */
	P.round = function () {
	  var x = this,
	    Ctor = x.constructor;

	  return finalise(new Ctor(x), x.e + 1, Ctor.rounding);
	};


	/*
	 * Return a new Decimal whose value is the sine of the value in radians of this Decimal.
	 *
	 * Domain: [-Infinity, Infinity]
	 * Range: [-1, 1]
	 *
	 * sin(x) = x - x^3/3! + x^5/5! - ...
	 *
	 * sin(0)         = 0
	 * sin(-0)        = -0
	 * sin(Infinity)  = NaN
	 * sin(-Infinity) = NaN
	 * sin(NaN)       = NaN
	 *
	 */
	P.sine = P.sin = function () {
	  var pr, rm,
	    x = this,
	    Ctor = x.constructor;

	  if (!x.isFinite()) return new Ctor(NaN);
	  if (x.isZero()) return new Ctor(x);

	  pr = Ctor.precision;
	  rm = Ctor.rounding;
	  Ctor.precision = pr + Math.max(x.e, x.sd()) + LOG_BASE;
	  Ctor.rounding = 1;

	  x = sine(Ctor, toLessThanHalfPi(Ctor, x));

	  Ctor.precision = pr;
	  Ctor.rounding = rm;

	  return finalise(quadrant > 2 ? x.neg() : x, pr, rm, true);
	};


	/*
	 * Return a new Decimal whose value is the square root of this Decimal, rounded to `precision`
	 * significant digits using rounding mode `rounding`.
	 *
	 *  sqrt(-n) =  N
	 *  sqrt(N)  =  N
	 *  sqrt(-I) =  N
	 *  sqrt(I)  =  I
	 *  sqrt(0)  =  0
	 *  sqrt(-0) = -0
	 *
	 */
	P.squareRoot = P.sqrt = function () {
	  var m, n, sd, r, rep, t,
	    x = this,
	    d = x.d,
	    e = x.e,
	    s = x.s,
	    Ctor = x.constructor;

	  // Negative/NaN/Infinity/zero?
	  if (s !== 1 || !d || !d[0]) {
	    return new Ctor(!s || s < 0 && (!d || d[0]) ? NaN : d ? x : 1 / 0);
	  }

	  external = false;

	  // Initial estimate.
	  s = Math.sqrt(+x);

	  // Math.sqrt underflow/overflow?
	  // Pass x to Math.sqrt as integer, then adjust the exponent of the result.
	  if (s == 0 || s == 1 / 0) {
	    n = digitsToString(d);

	    if ((n.length + e) % 2 == 0) n += '0';
	    s = Math.sqrt(n);
	    e = mathfloor((e + 1) / 2) - (e < 0 || e % 2);

	    if (s == 1 / 0) {
	      n = '5e' + e;
	    } else {
	      n = s.toExponential();
	      n = n.slice(0, n.indexOf('e') + 1) + e;
	    }

	    r = new Ctor(n);
	  } else {
	    r = new Ctor(s.toString());
	  }

	  sd = (e = Ctor.precision) + 3;

	  // Newton-Raphson iteration.
	  for (;;) {
	    t = r;
	    r = t.plus(divide(x, t, sd + 2, 1)).times(0.5);

	    // TODO? Replace with for-loop and checkRoundingDigits.
	    if (digitsToString(t.d).slice(0, sd) === (n = digitsToString(r.d)).slice(0, sd)) {
	      n = n.slice(sd - 3, sd + 1);

	      // The 4th rounding digit may be in error by -1 so if the 4 rounding digits are 9999 or
	      // 4999, i.e. approaching a rounding boundary, continue the iteration.
	      if (n == '9999' || !rep && n == '4999') {

	        // On the first iteration only, check to see if rounding up gives the exact result as the
	        // nines may infinitely repeat.
	        if (!rep) {
	          finalise(t, e + 1, 0);

	          if (t.times(t).eq(x)) {
	            r = t;
	            break;
	          }
	        }

	        sd += 4;
	        rep = 1;
	      } else {

	        // If the rounding digits are null, 0{0,4} or 50{0,3}, check for an exact result.
	        // If not, then there are further digits and m will be truthy.
	        if (!+n || !+n.slice(1) && n.charAt(0) == '5') {

	          // Truncate to the first rounding digit.
	          finalise(r, e + 1, 1);
	          m = !r.times(r).eq(x);
	        }

	        break;
	      }
	    }
	  }

	  external = true;

	  return finalise(r, e, Ctor.rounding, m);
	};


	/*
	 * Return a new Decimal whose value is the tangent of the value in radians of this Decimal.
	 *
	 * Domain: [-Infinity, Infinity]
	 * Range: [-Infinity, Infinity]
	 *
	 * tan(0)         = 0
	 * tan(-0)        = -0
	 * tan(Infinity)  = NaN
	 * tan(-Infinity) = NaN
	 * tan(NaN)       = NaN
	 *
	 */
	P.tangent = P.tan = function () {
	  var pr, rm,
	    x = this,
	    Ctor = x.constructor;

	  if (!x.isFinite()) return new Ctor(NaN);
	  if (x.isZero()) return new Ctor(x);

	  pr = Ctor.precision;
	  rm = Ctor.rounding;
	  Ctor.precision = pr + 10;
	  Ctor.rounding = 1;

	  x = x.sin();
	  x.s = 1;
	  x = divide(x, new Ctor(1).minus(x.times(x)).sqrt(), pr + 10, 0);

	  Ctor.precision = pr;
	  Ctor.rounding = rm;

	  return finalise(quadrant == 2 || quadrant == 4 ? x.neg() : x, pr, rm, true);
	};


	/*
	 *  n * 0 = 0
	 *  n * N = N
	 *  n * I = I
	 *  0 * n = 0
	 *  0 * 0 = 0
	 *  0 * N = N
	 *  0 * I = N
	 *  N * n = N
	 *  N * 0 = N
	 *  N * N = N
	 *  N * I = N
	 *  I * n = I
	 *  I * 0 = N
	 *  I * N = N
	 *  I * I = I
	 *
	 * Return a new Decimal whose value is this Decimal times `y`, rounded to `precision` significant
	 * digits using rounding mode `rounding`.
	 *
	 */
	P.times = P.mul = function (y) {
	  var carry, e, i, k, r, rL, t, xdL, ydL,
	    x = this,
	    Ctor = x.constructor,
	    xd = x.d,
	    yd = (y = new Ctor(y)).d;

	  y.s *= x.s;

	   // If either is NaN, ±Infinity or ±0...
	  if (!xd || !xd[0] || !yd || !yd[0]) {

	    return new Ctor(!y.s || xd && !xd[0] && !yd || yd && !yd[0] && !xd

	      // Return NaN if either is NaN.
	      // Return NaN if x is ±0 and y is ±Infinity, or y is ±0 and x is ±Infinity.
	      ? NaN

	      // Return ±Infinity if either is ±Infinity.
	      // Return ±0 if either is ±0.
	      : !xd || !yd ? y.s / 0 : y.s * 0);
	  }

	  e = mathfloor(x.e / LOG_BASE) + mathfloor(y.e / LOG_BASE);
	  xdL = xd.length;
	  ydL = yd.length;

	  // Ensure xd points to the longer array.
	  if (xdL < ydL) {
	    r = xd;
	    xd = yd;
	    yd = r;
	    rL = xdL;
	    xdL = ydL;
	    ydL = rL;
	  }

	  // Initialise the result array with zeros.
	  r = [];
	  rL = xdL + ydL;
	  for (i = rL; i--;) r.push(0);

	  // Multiply!
	  for (i = ydL; --i >= 0;) {
	    carry = 0;
	    for (k = xdL + i; k > i;) {
	      t = r[k] + yd[i] * xd[k - i - 1] + carry;
	      r[k--] = t % BASE | 0;
	      carry = t / BASE | 0;
	    }

	    r[k] = (r[k] + carry) % BASE | 0;
	  }

	  // Remove trailing zeros.
	  for (; !r[--rL];) r.pop();

	  if (carry) ++e;
	  else r.shift();

	  y.d = r;
	  y.e = getBase10Exponent(r, e);

	  return external ? finalise(y, Ctor.precision, Ctor.rounding) : y;
	};


	/*
	 * Return a string representing the value of this Decimal in base 2, round to `sd` significant
	 * digits using rounding mode `rm`.
	 *
	 * If the optional `sd` argument is present then return binary exponential notation.
	 *
	 * [sd] {number} Significant digits. Integer, 1 to MAX_DIGITS inclusive.
	 * [rm] {number} Rounding mode. Integer, 0 to 8 inclusive.
	 *
	 */
	P.toBinary = function (sd, rm) {
	  return toStringBinary(this, 2, sd, rm);
	};


	/*
	 * Return a new Decimal whose value is the value of this Decimal rounded to a maximum of `dp`
	 * decimal places using rounding mode `rm` or `rounding` if `rm` is omitted.
	 *
	 * If `dp` is omitted, return a new Decimal whose value is the value of this Decimal.
	 *
	 * [dp] {number} Decimal places. Integer, 0 to MAX_DIGITS inclusive.
	 * [rm] {number} Rounding mode. Integer, 0 to 8 inclusive.
	 *
	 */
	P.toDecimalPlaces = P.toDP = function (dp, rm) {
	  var x = this,
	    Ctor = x.constructor;

	  x = new Ctor(x);
	  if (dp === void 0) return x;

	  checkInt32(dp, 0, MAX_DIGITS);

	  if (rm === void 0) rm = Ctor.rounding;
	  else checkInt32(rm, 0, 8);

	  return finalise(x, dp + x.e + 1, rm);
	};


	/*
	 * Return a string representing the value of this Decimal in exponential notation rounded to
	 * `dp` fixed decimal places using rounding mode `rounding`.
	 *
	 * [dp] {number} Decimal places. Integer, 0 to MAX_DIGITS inclusive.
	 * [rm] {number} Rounding mode. Integer, 0 to 8 inclusive.
	 *
	 */
	P.toExponential = function (dp, rm) {
	  var str,
	    x = this,
	    Ctor = x.constructor;

	  if (dp === void 0) {
	    str = finiteToString(x, true);
	  } else {
	    checkInt32(dp, 0, MAX_DIGITS);

	    if (rm === void 0) rm = Ctor.rounding;
	    else checkInt32(rm, 0, 8);

	    x = finalise(new Ctor(x), dp + 1, rm);
	    str = finiteToString(x, true, dp + 1);
	  }

	  return x.isNeg() && !x.isZero() ? '-' + str : str;
	};


	/*
	 * Return a string representing the value of this Decimal in normal (fixed-point) notation to
	 * `dp` fixed decimal places and rounded using rounding mode `rm` or `rounding` if `rm` is
	 * omitted.
	 *
	 * As with JavaScript numbers, (-0).toFixed(0) is '0', but e.g. (-0.00001).toFixed(0) is '-0'.
	 *
	 * [dp] {number} Decimal places. Integer, 0 to MAX_DIGITS inclusive.
	 * [rm] {number} Rounding mode. Integer, 0 to 8 inclusive.
	 *
	 * (-0).toFixed(0) is '0', but (-0.1).toFixed(0) is '-0'.
	 * (-0).toFixed(1) is '0.0', but (-0.01).toFixed(1) is '-0.0'.
	 * (-0).toFixed(3) is '0.000'.
	 * (-0.5).toFixed(0) is '-0'.
	 *
	 */
	P.toFixed = function (dp, rm) {
	  var str, y,
	    x = this,
	    Ctor = x.constructor;

	  if (dp === void 0) {
	    str = finiteToString(x);
	  } else {
	    checkInt32(dp, 0, MAX_DIGITS);

	    if (rm === void 0) rm = Ctor.rounding;
	    else checkInt32(rm, 0, 8);

	    y = finalise(new Ctor(x), dp + x.e + 1, rm);
	    str = finiteToString(y, false, dp + y.e + 1);
	  }

	  // To determine whether to add the minus sign look at the value before it was rounded,
	  // i.e. look at `x` rather than `y`.
	  return x.isNeg() && !x.isZero() ? '-' + str : str;
	};


	/*
	 * Return an array representing the value of this Decimal as a simple fraction with an integer
	 * numerator and an integer denominator.
	 *
	 * The denominator will be a positive non-zero value less than or equal to the specified maximum
	 * denominator. If a maximum denominator is not specified, the denominator will be the lowest
	 * value necessary to represent the number exactly.
	 *
	 * [maxD] {number|string|Decimal} Maximum denominator. Integer >= 1 and < Infinity.
	 *
	 */
	P.toFraction = function (maxD) {
	  var d, d0, d1, d2, e, k, n, n0, n1, pr, q, r,
	    x = this,
	    xd = x.d,
	    Ctor = x.constructor;

	  if (!xd) return new Ctor(x);

	  n1 = d0 = new Ctor(1);
	  d1 = n0 = new Ctor(0);

	  d = new Ctor(d1);
	  e = d.e = getPrecision(xd) - x.e - 1;
	  k = e % LOG_BASE;
	  d.d[0] = mathpow(10, k < 0 ? LOG_BASE + k : k);

	  if (maxD == null) {

	    // d is 10**e, the minimum max-denominator needed.
	    maxD = e > 0 ? d : n1;
	  } else {
	    n = new Ctor(maxD);
	    if (!n.isInt() || n.lt(n1)) throw Error(invalidArgument + n);
	    maxD = n.gt(d) ? (e > 0 ? d : n1) : n;
	  }

	  external = false;
	  n = new Ctor(digitsToString(xd));
	  pr = Ctor.precision;
	  Ctor.precision = e = xd.length * LOG_BASE * 2;

	  for (;;)  {
	    q = divide(n, d, 0, 1, 1);
	    d2 = d0.plus(q.times(d1));
	    if (d2.cmp(maxD) == 1) break;
	    d0 = d1;
	    d1 = d2;
	    d2 = n1;
	    n1 = n0.plus(q.times(d2));
	    n0 = d2;
	    d2 = d;
	    d = n.minus(q.times(d2));
	    n = d2;
	  }

	  d2 = divide(maxD.minus(d0), d1, 0, 1, 1);
	  n0 = n0.plus(d2.times(n1));
	  d0 = d0.plus(d2.times(d1));
	  n0.s = n1.s = x.s;

	  // Determine which fraction is closer to x, n0/d0 or n1/d1?
	  r = divide(n1, d1, e, 1).minus(x).abs().cmp(divide(n0, d0, e, 1).minus(x).abs()) < 1
	      ? [n1, d1] : [n0, d0];

	  Ctor.precision = pr;
	  external = true;

	  return r;
	};


	/*
	 * Return a string representing the value of this Decimal in base 16, round to `sd` significant
	 * digits using rounding mode `rm`.
	 *
	 * If the optional `sd` argument is present then return binary exponential notation.
	 *
	 * [sd] {number} Significant digits. Integer, 1 to MAX_DIGITS inclusive.
	 * [rm] {number} Rounding mode. Integer, 0 to 8 inclusive.
	 *
	 */
	P.toHexadecimal = P.toHex = function (sd, rm) {
	  return toStringBinary(this, 16, sd, rm);
	};


	/*
	 * Returns a new Decimal whose value is the nearest multiple of `y` in the direction of rounding
	 * mode `rm`, or `Decimal.rounding` if `rm` is omitted, to the value of this Decimal.
	 *
	 * The return value will always have the same sign as this Decimal, unless either this Decimal
	 * or `y` is NaN, in which case the return value will be also be NaN.
	 *
	 * The return value is not affected by the value of `precision`.
	 *
	 * y {number|string|Decimal} The magnitude to round to a multiple of.
	 * [rm] {number} Rounding mode. Integer, 0 to 8 inclusive.
	 *
	 * 'toNearest() rounding mode not an integer: {rm}'
	 * 'toNearest() rounding mode out of range: {rm}'
	 *
	 */
	P.toNearest = function (y, rm) {
	  var x = this,
	    Ctor = x.constructor;

	  x = new Ctor(x);

	  if (y == null) {

	    // If x is not finite, return x.
	    if (!x.d) return x;

	    y = new Ctor(1);
	    rm = Ctor.rounding;
	  } else {
	    y = new Ctor(y);
	    if (rm === void 0) {
	      rm = Ctor.rounding;
	    } else {
	      checkInt32(rm, 0, 8);
	    }

	    // If x is not finite, return x if y is not NaN, else NaN.
	    if (!x.d) return y.s ? x : y;

	    // If y is not finite, return Infinity with the sign of x if y is Infinity, else NaN.
	    if (!y.d) {
	      if (y.s) y.s = x.s;
	      return y;
	    }
	  }

	  // If y is not zero, calculate the nearest multiple of y to x.
	  if (y.d[0]) {
	    external = false;
	    x = divide(x, y, 0, rm, 1).times(y);
	    external = true;
	    finalise(x);

	  // If y is zero, return zero with the sign of x.
	  } else {
	    y.s = x.s;
	    x = y;
	  }

	  return x;
	};


	/*
	 * Return the value of this Decimal converted to a number primitive.
	 * Zero keeps its sign.
	 *
	 */
	P.toNumber = function () {
	  return +this;
	};


	/*
	 * Return a string representing the value of this Decimal in base 8, round to `sd` significant
	 * digits using rounding mode `rm`.
	 *
	 * If the optional `sd` argument is present then return binary exponential notation.
	 *
	 * [sd] {number} Significant digits. Integer, 1 to MAX_DIGITS inclusive.
	 * [rm] {number} Rounding mode. Integer, 0 to 8 inclusive.
	 *
	 */
	P.toOctal = function (sd, rm) {
	  return toStringBinary(this, 8, sd, rm);
	};


	/*
	 * Return a new Decimal whose value is the value of this Decimal raised to the power `y`, rounded
	 * to `precision` significant digits using rounding mode `rounding`.
	 *
	 * ECMAScript compliant.
	 *
	 *   pow(x, NaN)                           = NaN
	 *   pow(x, ±0)                            = 1

	 *   pow(NaN, non-zero)                    = NaN
	 *   pow(abs(x) > 1, +Infinity)            = +Infinity
	 *   pow(abs(x) > 1, -Infinity)            = +0
	 *   pow(abs(x) == 1, ±Infinity)           = NaN
	 *   pow(abs(x) < 1, +Infinity)            = +0
	 *   pow(abs(x) < 1, -Infinity)            = +Infinity
	 *   pow(+Infinity, y > 0)                 = +Infinity
	 *   pow(+Infinity, y < 0)                 = +0
	 *   pow(-Infinity, odd integer > 0)       = -Infinity
	 *   pow(-Infinity, even integer > 0)      = +Infinity
	 *   pow(-Infinity, odd integer < 0)       = -0
	 *   pow(-Infinity, even integer < 0)      = +0
	 *   pow(+0, y > 0)                        = +0
	 *   pow(+0, y < 0)                        = +Infinity
	 *   pow(-0, odd integer > 0)              = -0
	 *   pow(-0, even integer > 0)             = +0
	 *   pow(-0, odd integer < 0)              = -Infinity
	 *   pow(-0, even integer < 0)             = +Infinity
	 *   pow(finite x < 0, finite non-integer) = NaN
	 *
	 * For non-integer or very large exponents pow(x, y) is calculated using
	 *
	 *   x^y = exp(y*ln(x))
	 *
	 * Assuming the first 15 rounding digits are each equally likely to be any digit 0-9, the
	 * probability of an incorrectly rounded result
	 * P([49]9{14} | [50]0{14}) = 2 * 0.2 * 10^-14 = 4e-15 = 1/2.5e+14
	 * i.e. 1 in 250,000,000,000,000
	 *
	 * If a result is incorrectly rounded the maximum error will be 1 ulp (unit in last place).
	 *
	 * y {number|string|Decimal} The power to which to raise this Decimal.
	 *
	 */
	P.toPower = P.pow = function (y) {
	  var e, k, pr, r, rm, s,
	    x = this,
	    Ctor = x.constructor,
	    yn = +(y = new Ctor(y));

	  // Either ±Infinity, NaN or ±0?
	  if (!x.d || !y.d || !x.d[0] || !y.d[0]) return new Ctor(mathpow(+x, yn));

	  x = new Ctor(x);

	  if (x.eq(1)) return x;

	  pr = Ctor.precision;
	  rm = Ctor.rounding;

	  if (y.eq(1)) return finalise(x, pr, rm);

	  // y exponent
	  e = mathfloor(y.e / LOG_BASE);

	  // If y is a small integer use the 'exponentiation by squaring' algorithm.
	  if (e >= y.d.length - 1 && (k = yn < 0 ? -yn : yn) <= MAX_SAFE_INTEGER) {
	    r = intPow(Ctor, x, k, pr);
	    return y.s < 0 ? new Ctor(1).div(r) : finalise(r, pr, rm);
	  }

	  s = x.s;

	  // if x is negative
	  if (s < 0) {

	    // if y is not an integer
	    if (e < y.d.length - 1) return new Ctor(NaN);

	    // Result is positive if x is negative and the last digit of integer y is even.
	    if ((y.d[e] & 1) == 0) s = 1;

	    // if x.eq(-1)
	    if (x.e == 0 && x.d[0] == 1 && x.d.length == 1) {
	      x.s = s;
	      return x;
	    }
	  }

	  // Estimate result exponent.
	  // x^y = 10^e,  where e = y * log10(x)
	  // log10(x) = log10(x_significand) + x_exponent
	  // log10(x_significand) = ln(x_significand) / ln(10)
	  k = mathpow(+x, yn);
	  e = k == 0 || !isFinite(k)
	    ? mathfloor(yn * (Math.log('0.' + digitsToString(x.d)) / Math.LN10 + x.e + 1))
	    : new Ctor(k + '').e;

	  // Exponent estimate may be incorrect e.g. x: 0.999999999999999999, y: 2.29, e: 0, r.e: -1.

	  // Overflow/underflow?
	  if (e > Ctor.maxE + 1 || e < Ctor.minE - 1) return new Ctor(e > 0 ? s / 0 : 0);

	  external = false;
	  Ctor.rounding = x.s = 1;

	  // Estimate the extra guard digits needed to ensure five correct rounding digits from
	  // naturalLogarithm(x). Example of failure without these extra digits (precision: 10):
	  // new Decimal(2.32456).pow('2087987436534566.46411')
	  // should be 1.162377823e+764914905173815, but is 1.162355823e+764914905173815
	  k = Math.min(12, (e + '').length);

	  // r = x^y = exp(y*ln(x))
	  r = naturalExponential(y.times(naturalLogarithm(x, pr + k)), pr);

	  // r may be Infinity, e.g. (0.9999999999999999).pow(-1e+40)
	  if (r.d) {

	    // Truncate to the required precision plus five rounding digits.
	    r = finalise(r, pr + 5, 1);

	    // If the rounding digits are [49]9999 or [50]0000 increase the precision by 10 and recalculate
	    // the result.
	    if (checkRoundingDigits(r.d, pr, rm)) {
	      e = pr + 10;

	      // Truncate to the increased precision plus five rounding digits.
	      r = finalise(naturalExponential(y.times(naturalLogarithm(x, e + k)), e), e + 5, 1);

	      // Check for 14 nines from the 2nd rounding digit (the first rounding digit may be 4 or 9).
	      if (+digitsToString(r.d).slice(pr + 1, pr + 15) + 1 == 1e14) {
	        r = finalise(r, pr + 1, 0);
	      }
	    }
	  }

	  r.s = s;
	  external = true;
	  Ctor.rounding = rm;

	  return finalise(r, pr, rm);
	};


	/*
	 * Return a string representing the value of this Decimal rounded to `sd` significant digits
	 * using rounding mode `rounding`.
	 *
	 * Return exponential notation if `sd` is less than the number of digits necessary to represent
	 * the integer part of the value in normal notation.
	 *
	 * [sd] {number} Significant digits. Integer, 1 to MAX_DIGITS inclusive.
	 * [rm] {number} Rounding mode. Integer, 0 to 8 inclusive.
	 *
	 */
	P.toPrecision = function (sd, rm) {
	  var str,
	    x = this,
	    Ctor = x.constructor;

	  if (sd === void 0) {
	    str = finiteToString(x, x.e <= Ctor.toExpNeg || x.e >= Ctor.toExpPos);
	  } else {
	    checkInt32(sd, 1, MAX_DIGITS);

	    if (rm === void 0) rm = Ctor.rounding;
	    else checkInt32(rm, 0, 8);

	    x = finalise(new Ctor(x), sd, rm);
	    str = finiteToString(x, sd <= x.e || x.e <= Ctor.toExpNeg, sd);
	  }

	  return x.isNeg() && !x.isZero() ? '-' + str : str;
	};


	/*
	 * Return a new Decimal whose value is the value of this Decimal rounded to a maximum of `sd`
	 * significant digits using rounding mode `rm`, or to `precision` and `rounding` respectively if
	 * omitted.
	 *
	 * [sd] {number} Significant digits. Integer, 1 to MAX_DIGITS inclusive.
	 * [rm] {number} Rounding mode. Integer, 0 to 8 inclusive.
	 *
	 * 'toSD() digits out of range: {sd}'
	 * 'toSD() digits not an integer: {sd}'
	 * 'toSD() rounding mode not an integer: {rm}'
	 * 'toSD() rounding mode out of range: {rm}'
	 *
	 */
	P.toSignificantDigits = P.toSD = function (sd, rm) {
	  var x = this,
	    Ctor = x.constructor;

	  if (sd === void 0) {
	    sd = Ctor.precision;
	    rm = Ctor.rounding;
	  } else {
	    checkInt32(sd, 1, MAX_DIGITS);

	    if (rm === void 0) rm = Ctor.rounding;
	    else checkInt32(rm, 0, 8);
	  }

	  return finalise(new Ctor(x), sd, rm);
	};


	/*
	 * Return a string representing the value of this Decimal.
	 *
	 * Return exponential notation if this Decimal has a positive exponent equal to or greater than
	 * `toExpPos`, or a negative exponent equal to or less than `toExpNeg`.
	 *
	 */
	P.toString = function () {
	  var x = this,
	    Ctor = x.constructor,
	    str = finiteToString(x, x.e <= Ctor.toExpNeg || x.e >= Ctor.toExpPos);

	  return x.isNeg() && !x.isZero() ? '-' + str : str;
	};


	/*
	 * Return a new Decimal whose value is the value of this Decimal truncated to a whole number.
	 *
	 */
	P.truncated = P.trunc = function () {
	  return finalise(new this.constructor(this), this.e + 1, 1);
	};


	/*
	 * Return a string representing the value of this Decimal.
	 * Unlike `toString`, negative zero will include the minus sign.
	 *
	 */
	P.valueOf = P.toJSON = function () {
	  var x = this,
	    Ctor = x.constructor,
	    str = finiteToString(x, x.e <= Ctor.toExpNeg || x.e >= Ctor.toExpPos);

	  return x.isNeg() ? '-' + str : str;
	};


	// Helper functions for Decimal.prototype (P) and/or Decimal methods, and their callers.


	/*
	 *  digitsToString           P.cubeRoot, P.logarithm, P.squareRoot, P.toFraction, P.toPower,
	 *                           finiteToString, naturalExponential, naturalLogarithm
	 *  checkInt32               P.toDecimalPlaces, P.toExponential, P.toFixed, P.toNearest,
	 *                           P.toPrecision, P.toSignificantDigits, toStringBinary, random
	 *  checkRoundingDigits      P.logarithm, P.toPower, naturalExponential, naturalLogarithm
	 *  convertBase              toStringBinary, parseOther
	 *  cos                      P.cos
	 *  divide                   P.atanh, P.cubeRoot, P.dividedBy, P.dividedToIntegerBy,
	 *                           P.logarithm, P.modulo, P.squareRoot, P.tan, P.tanh, P.toFraction,
	 *                           P.toNearest, toStringBinary, naturalExponential, naturalLogarithm,
	 *                           taylorSeries, atan2, parseOther
	 *  finalise                 P.absoluteValue, P.atan, P.atanh, P.ceil, P.cos, P.cosh,
	 *                           P.cubeRoot, P.dividedToIntegerBy, P.floor, P.logarithm, P.minus,
	 *                           P.modulo, P.negated, P.plus, P.round, P.sin, P.sinh, P.squareRoot,
	 *                           P.tan, P.times, P.toDecimalPlaces, P.toExponential, P.toFixed,
	 *                           P.toNearest, P.toPower, P.toPrecision, P.toSignificantDigits,
	 *                           P.truncated, divide, getLn10, getPi, naturalExponential,
	 *                           naturalLogarithm, ceil, floor, round, trunc
	 *  finiteToString           P.toExponential, P.toFixed, P.toPrecision, P.toString, P.valueOf,
	 *                           toStringBinary
	 *  getBase10Exponent        P.minus, P.plus, P.times, parseOther
	 *  getLn10                  P.logarithm, naturalLogarithm
	 *  getPi                    P.acos, P.asin, P.atan, toLessThanHalfPi, atan2
	 *  getPrecision             P.precision, P.toFraction
	 *  getZeroString            digitsToString, finiteToString
	 *  intPow                   P.toPower, parseOther
	 *  isOdd                    toLessThanHalfPi
	 *  maxOrMin                 max, min
	 *  naturalExponential       P.naturalExponential, P.toPower
	 *  naturalLogarithm         P.acosh, P.asinh, P.atanh, P.logarithm, P.naturalLogarithm,
	 *                           P.toPower, naturalExponential
	 *  nonFiniteToString        finiteToString, toStringBinary
	 *  parseDecimal             Decimal
	 *  parseOther               Decimal
	 *  sin                      P.sin
	 *  taylorSeries             P.cosh, P.sinh, cos, sin
	 *  toLessThanHalfPi         P.cos, P.sin
	 *  toStringBinary           P.toBinary, P.toHexadecimal, P.toOctal
	 *  truncate                 intPow
	 *
	 *  Throws:                  P.logarithm, P.precision, P.toFraction, checkInt32, getLn10, getPi,
	 *                           naturalLogarithm, config, parseOther, random, Decimal
	 */


	function digitsToString(d) {
	  var i, k, ws,
	    indexOfLastWord = d.length - 1,
	    str = '',
	    w = d[0];

	  if (indexOfLastWord > 0) {
	    str += w;
	    for (i = 1; i < indexOfLastWord; i++) {
	      ws = d[i] + '';
	      k = LOG_BASE - ws.length;
	      if (k) str += getZeroString(k);
	      str += ws;
	    }

	    w = d[i];
	    ws = w + '';
	    k = LOG_BASE - ws.length;
	    if (k) str += getZeroString(k);
	  } else if (w === 0) {
	    return '0';
	  }

	  // Remove trailing zeros of last w.
	  for (; w % 10 === 0;) w /= 10;

	  return str + w;
	}


	function checkInt32(i, min, max) {
	  if (i !== ~~i || i < min || i > max) {
	    throw Error(invalidArgument + i);
	  }
	}


	/*
	 * Check 5 rounding digits if `repeating` is null, 4 otherwise.
	 * `repeating == null` if caller is `log` or `pow`,
	 * `repeating != null` if caller is `naturalLogarithm` or `naturalExponential`.
	 */
	function checkRoundingDigits(d, i, rm, repeating) {
	  var di, k, r, rd;

	  // Get the length of the first word of the array d.
	  for (k = d[0]; k >= 10; k /= 10) --i;

	  // Is the rounding digit in the first word of d?
	  if (--i < 0) {
	    i += LOG_BASE;
	    di = 0;
	  } else {
	    di = Math.ceil((i + 1) / LOG_BASE);
	    i %= LOG_BASE;
	  }

	  // i is the index (0 - 6) of the rounding digit.
	  // E.g. if within the word 3487563 the first rounding digit is 5,
	  // then i = 4, k = 1000, rd = 3487563 % 1000 = 563
	  k = mathpow(10, LOG_BASE - i);
	  rd = d[di] % k | 0;

	  if (repeating == null) {
	    if (i < 3) {
	      if (i == 0) rd = rd / 100 | 0;
	      else if (i == 1) rd = rd / 10 | 0;
	      r = rm < 4 && rd == 99999 || rm > 3 && rd == 49999 || rd == 50000 || rd == 0;
	    } else {
	      r = (rm < 4 && rd + 1 == k || rm > 3 && rd + 1 == k / 2) &&
	        (d[di + 1] / k / 100 | 0) == mathpow(10, i - 2) - 1 ||
	          (rd == k / 2 || rd == 0) && (d[di + 1] / k / 100 | 0) == 0;
	    }
	  } else {
	    if (i < 4) {
	      if (i == 0) rd = rd / 1000 | 0;
	      else if (i == 1) rd = rd / 100 | 0;
	      else if (i == 2) rd = rd / 10 | 0;
	      r = (repeating || rm < 4) && rd == 9999 || !repeating && rm > 3 && rd == 4999;
	    } else {
	      r = ((repeating || rm < 4) && rd + 1 == k ||
	      (!repeating && rm > 3) && rd + 1 == k / 2) &&
	        (d[di + 1] / k / 1000 | 0) == mathpow(10, i - 3) - 1;
	    }
	  }

	  return r;
	}


	// Convert string of `baseIn` to an array of numbers of `baseOut`.
	// Eg. convertBase('255', 10, 16) returns [15, 15].
	// Eg. convertBase('ff', 16, 10) returns [2, 5, 5].
	function convertBase(str, baseIn, baseOut) {
	  var j,
	    arr = [0],
	    arrL,
	    i = 0,
	    strL = str.length;

	  for (; i < strL;) {
	    for (arrL = arr.length; arrL--;) arr[arrL] *= baseIn;
	    arr[0] += NUMERALS.indexOf(str.charAt(i++));
	    for (j = 0; j < arr.length; j++) {
	      if (arr[j] > baseOut - 1) {
	        if (arr[j + 1] === void 0) arr[j + 1] = 0;
	        arr[j + 1] += arr[j] / baseOut | 0;
	        arr[j] %= baseOut;
	      }
	    }
	  }

	  return arr.reverse();
	}


	/*
	 * cos(x) = 1 - x^2/2! + x^4/4! - ...
	 * |x| < pi/2
	 *
	 */
	function cosine(Ctor, x) {
	  var k, len, y;

	  if (x.isZero()) return x;

	  // Argument reduction: cos(4x) = 8*(cos^4(x) - cos^2(x)) + 1
	  // i.e. cos(x) = 8*(cos^4(x/4) - cos^2(x/4)) + 1

	  // Estimate the optimum number of times to use the argument reduction.
	  len = x.d.length;
	  if (len < 32) {
	    k = Math.ceil(len / 3);
	    y = (1 / tinyPow(4, k)).toString();
	  } else {
	    k = 16;
	    y = '2.3283064365386962890625e-10';
	  }

	  Ctor.precision += k;

	  x = taylorSeries(Ctor, 1, x.times(y), new Ctor(1));

	  // Reverse argument reduction
	  for (var i = k; i--;) {
	    var cos2x = x.times(x);
	    x = cos2x.times(cos2x).minus(cos2x).times(8).plus(1);
	  }

	  Ctor.precision -= k;

	  return x;
	}


	/*
	 * Perform division in the specified base.
	 */
	var divide = (function () {

	  // Assumes non-zero x and k, and hence non-zero result.
	  function multiplyInteger(x, k, base) {
	    var temp,
	      carry = 0,
	      i = x.length;

	    for (x = x.slice(); i--;) {
	      temp = x[i] * k + carry;
	      x[i] = temp % base | 0;
	      carry = temp / base | 0;
	    }

	    if (carry) x.unshift(carry);

	    return x;
	  }

	  function compare(a, b, aL, bL) {
	    var i, r;

	    if (aL != bL) {
	      r = aL > bL ? 1 : -1;
	    } else {
	      for (i = r = 0; i < aL; i++) {
	        if (a[i] != b[i]) {
	          r = a[i] > b[i] ? 1 : -1;
	          break;
	        }
	      }
	    }

	    return r;
	  }

	  function subtract(a, b, aL, base) {
	    var i = 0;

	    // Subtract b from a.
	    for (; aL--;) {
	      a[aL] -= i;
	      i = a[aL] < b[aL] ? 1 : 0;
	      a[aL] = i * base + a[aL] - b[aL];
	    }

	    // Remove leading zeros.
	    for (; !a[0] && a.length > 1;) a.shift();
	  }

	  return function (x, y, pr, rm, dp, base) {
	    var cmp, e, i, k, logBase, more, prod, prodL, q, qd, rem, remL, rem0, sd, t, xi, xL, yd0,
	      yL, yz,
	      Ctor = x.constructor,
	      sign = x.s == y.s ? 1 : -1,
	      xd = x.d,
	      yd = y.d;

	    // Either NaN, Infinity or 0?
	    if (!xd || !xd[0] || !yd || !yd[0]) {

	      return new Ctor(// Return NaN if either NaN, or both Infinity or 0.
	        !x.s || !y.s || (xd ? yd && xd[0] == yd[0] : !yd) ? NaN :

	        // Return ±0 if x is 0 or y is ±Infinity, or return ±Infinity as y is 0.
	        xd && xd[0] == 0 || !yd ? sign * 0 : sign / 0);
	    }

	    if (base) {
	      logBase = 1;
	      e = x.e - y.e;
	    } else {
	      base = BASE;
	      logBase = LOG_BASE;
	      e = mathfloor(x.e / logBase) - mathfloor(y.e / logBase);
	    }

	    yL = yd.length;
	    xL = xd.length;
	    q = new Ctor(sign);
	    qd = q.d = [];

	    // Result exponent may be one less than e.
	    // The digit array of a Decimal from toStringBinary may have trailing zeros.
	    for (i = 0; yd[i] == (xd[i] || 0); i++);

	    if (yd[i] > (xd[i] || 0)) e--;

	    if (pr == null) {
	      sd = pr = Ctor.precision;
	      rm = Ctor.rounding;
	    } else if (dp) {
	      sd = pr + (x.e - y.e) + 1;
	    } else {
	      sd = pr;
	    }

	    if (sd < 0) {
	      qd.push(1);
	      more = true;
	    } else {

	      // Convert precision in number of base 10 digits to base 1e7 digits.
	      sd = sd / logBase + 2 | 0;
	      i = 0;

	      // divisor < 1e7
	      if (yL == 1) {
	        k = 0;
	        yd = yd[0];
	        sd++;

	        // k is the carry.
	        for (; (i < xL || k) && sd--; i++) {
	          t = k * base + (xd[i] || 0);
	          qd[i] = t / yd | 0;
	          k = t % yd | 0;
	        }

	        more = k || i < xL;

	      // divisor >= 1e7
	      } else {

	        // Normalise xd and yd so highest order digit of yd is >= base/2
	        k = base / (yd[0] + 1) | 0;

	        if (k > 1) {
	          yd = multiplyInteger(yd, k, base);
	          xd = multiplyInteger(xd, k, base);
	          yL = yd.length;
	          xL = xd.length;
	        }

	        xi = yL;
	        rem = xd.slice(0, yL);
	        remL = rem.length;

	        // Add zeros to make remainder as long as divisor.
	        for (; remL < yL;) rem[remL++] = 0;

	        yz = yd.slice();
	        yz.unshift(0);
	        yd0 = yd[0];

	        if (yd[1] >= base / 2) ++yd0;

	        do {
	          k = 0;

	          // Compare divisor and remainder.
	          cmp = compare(yd, rem, yL, remL);

	          // If divisor < remainder.
	          if (cmp < 0) {

	            // Calculate trial digit, k.
	            rem0 = rem[0];
	            if (yL != remL) rem0 = rem0 * base + (rem[1] || 0);

	            // k will be how many times the divisor goes into the current remainder.
	            k = rem0 / yd0 | 0;

	            //  Algorithm:
	            //  1. product = divisor * trial digit (k)
	            //  2. if product > remainder: product -= divisor, k--
	            //  3. remainder -= product
	            //  4. if product was < remainder at 2:
	            //    5. compare new remainder and divisor
	            //    6. If remainder > divisor: remainder -= divisor, k++

	            if (k > 1) {
	              if (k >= base) k = base - 1;

	              // product = divisor * trial digit.
	              prod = multiplyInteger(yd, k, base);
	              prodL = prod.length;
	              remL = rem.length;

	              // Compare product and remainder.
	              cmp = compare(prod, rem, prodL, remL);

	              // product > remainder.
	              if (cmp == 1) {
	                k--;

	                // Subtract divisor from product.
	                subtract(prod, yL < prodL ? yz : yd, prodL, base);
	              }
	            } else {

	              // cmp is -1.
	              // If k is 0, there is no need to compare yd and rem again below, so change cmp to 1
	              // to avoid it. If k is 1 there is a need to compare yd and rem again below.
	              if (k == 0) cmp = k = 1;
	              prod = yd.slice();
	            }

	            prodL = prod.length;
	            if (prodL < remL) prod.unshift(0);

	            // Subtract product from remainder.
	            subtract(rem, prod, remL, base);

	            // If product was < previous remainder.
	            if (cmp == -1) {
	              remL = rem.length;

	              // Compare divisor and new remainder.
	              cmp = compare(yd, rem, yL, remL);

	              // If divisor < new remainder, subtract divisor from remainder.
	              if (cmp < 1) {
	                k++;

	                // Subtract divisor from remainder.
	                subtract(rem, yL < remL ? yz : yd, remL, base);
	              }
	            }

	            remL = rem.length;
	          } else if (cmp === 0) {
	            k++;
	            rem = [0];
	          }    // if cmp === 1, k will be 0

	          // Add the next digit, k, to the result array.
	          qd[i++] = k;

	          // Update the remainder.
	          if (cmp && rem[0]) {
	            rem[remL++] = xd[xi] || 0;
	          } else {
	            rem = [xd[xi]];
	            remL = 1;
	          }

	        } while ((xi++ < xL || rem[0] !== void 0) && sd--);

	        more = rem[0] !== void 0;
	      }

	      // Leading zero?
	      if (!qd[0]) qd.shift();
	    }

	    // logBase is 1 when divide is being used for base conversion.
	    if (logBase == 1) {
	      q.e = e;
	      inexact = more;
	    } else {

	      // To calculate q.e, first get the number of digits of qd[0].
	      for (i = 1, k = qd[0]; k >= 10; k /= 10) i++;
	      q.e = i + e * logBase - 1;

	      finalise(q, dp ? pr + q.e + 1 : pr, rm, more);
	    }

	    return q;
	  };
	})();


	/*
	 * Round `x` to `sd` significant digits using rounding mode `rm`.
	 * Check for over/under-flow.
	 */
	 function finalise(x, sd, rm, isTruncated) {
	  var digits, i, j, k, rd, roundUp, w, xd, xdi,
	    Ctor = x.constructor;

	  // Don't round if sd is null or undefined.
	  out: if (sd != null) {
	    xd = x.d;

	    // Infinity/NaN.
	    if (!xd) return x;

	    // rd: the rounding digit, i.e. the digit after the digit that may be rounded up.
	    // w: the word of xd containing rd, a base 1e7 number.
	    // xdi: the index of w within xd.
	    // digits: the number of digits of w.
	    // i: what would be the index of rd within w if all the numbers were 7 digits long (i.e. if
	    // they had leading zeros)
	    // j: if > 0, the actual index of rd within w (if < 0, rd is a leading zero).

	    // Get the length of the first word of the digits array xd.
	    for (digits = 1, k = xd[0]; k >= 10; k /= 10) digits++;
	    i = sd - digits;

	    // Is the rounding digit in the first word of xd?
	    if (i < 0) {
	      i += LOG_BASE;
	      j = sd;
	      w = xd[xdi = 0];

	      // Get the rounding digit at index j of w.
	      rd = w / mathpow(10, digits - j - 1) % 10 | 0;
	    } else {
	      xdi = Math.ceil((i + 1) / LOG_BASE);
	      k = xd.length;
	      if (xdi >= k) {
	        if (isTruncated) {

	          // Needed by `naturalExponential`, `naturalLogarithm` and `squareRoot`.
	          for (; k++ <= xdi;) xd.push(0);
	          w = rd = 0;
	          digits = 1;
	          i %= LOG_BASE;
	          j = i - LOG_BASE + 1;
	        } else {
	          break out;
	        }
	      } else {
	        w = k = xd[xdi];

	        // Get the number of digits of w.
	        for (digits = 1; k >= 10; k /= 10) digits++;

	        // Get the index of rd within w.
	        i %= LOG_BASE;

	        // Get the index of rd within w, adjusted for leading zeros.
	        // The number of leading zeros of w is given by LOG_BASE - digits.
	        j = i - LOG_BASE + digits;

	        // Get the rounding digit at index j of w.
	        rd = j < 0 ? 0 : w / mathpow(10, digits - j - 1) % 10 | 0;
	      }
	    }

	    // Are there any non-zero digits after the rounding digit?
	    isTruncated = isTruncated || sd < 0 ||
	      xd[xdi + 1] !== void 0 || (j < 0 ? w : w % mathpow(10, digits - j - 1));

	    // The expression `w % mathpow(10, digits - j - 1)` returns all the digits of w to the right
	    // of the digit at (left-to-right) index j, e.g. if w is 908714 and j is 2, the expression
	    // will give 714.

	    roundUp = rm < 4
	      ? (rd || isTruncated) && (rm == 0 || rm == (x.s < 0 ? 3 : 2))
	      : rd > 5 || rd == 5 && (rm == 4 || isTruncated || rm == 6 &&

	        // Check whether the digit to the left of the rounding digit is odd.
	        ((i > 0 ? j > 0 ? w / mathpow(10, digits - j) : 0 : xd[xdi - 1]) % 10) & 1 ||
	          rm == (x.s < 0 ? 8 : 7));

	    if (sd < 1 || !xd[0]) {
	      xd.length = 0;
	      if (roundUp) {

	        // Convert sd to decimal places.
	        sd -= x.e + 1;

	        // 1, 0.1, 0.01, 0.001, 0.0001 etc.
	        xd[0] = mathpow(10, (LOG_BASE - sd % LOG_BASE) % LOG_BASE);
	        x.e = -sd || 0;
	      } else {

	        // Zero.
	        xd[0] = x.e = 0;
	      }

	      return x;
	    }

	    // Remove excess digits.
	    if (i == 0) {
	      xd.length = xdi;
	      k = 1;
	      xdi--;
	    } else {
	      xd.length = xdi + 1;
	      k = mathpow(10, LOG_BASE - i);

	      // E.g. 56700 becomes 56000 if 7 is the rounding digit.
	      // j > 0 means i > number of leading zeros of w.
	      xd[xdi] = j > 0 ? (w / mathpow(10, digits - j) % mathpow(10, j) | 0) * k : 0;
	    }

	    if (roundUp) {
	      for (;;) {

	        // Is the digit to be rounded up in the first word of xd?
	        if (xdi == 0) {

	          // i will be the length of xd[0] before k is added.
	          for (i = 1, j = xd[0]; j >= 10; j /= 10) i++;
	          j = xd[0] += k;
	          for (k = 1; j >= 10; j /= 10) k++;

	          // if i != k the length has increased.
	          if (i != k) {
	            x.e++;
	            if (xd[0] == BASE) xd[0] = 1;
	          }

	          break;
	        } else {
	          xd[xdi] += k;
	          if (xd[xdi] != BASE) break;
	          xd[xdi--] = 0;
	          k = 1;
	        }
	      }
	    }

	    // Remove trailing zeros.
	    for (i = xd.length; xd[--i] === 0;) xd.pop();
	  }

	  if (external) {

	    // Overflow?
	    if (x.e > Ctor.maxE) {

	      // Infinity.
	      x.d = null;
	      x.e = NaN;

	    // Underflow?
	    } else if (x.e < Ctor.minE) {

	      // Zero.
	      x.e = 0;
	      x.d = [0];
	      // Ctor.underflow = true;
	    } // else Ctor.underflow = false;
	  }

	  return x;
	}


	function finiteToString(x, isExp, sd) {
	  if (!x.isFinite()) return nonFiniteToString(x);
	  var k,
	    e = x.e,
	    str = digitsToString(x.d),
	    len = str.length;

	  if (isExp) {
	    if (sd && (k = sd - len) > 0) {
	      str = str.charAt(0) + '.' + str.slice(1) + getZeroString(k);
	    } else if (len > 1) {
	      str = str.charAt(0) + '.' + str.slice(1);
	    }

	    str = str + (x.e < 0 ? 'e' : 'e+') + x.e;
	  } else if (e < 0) {
	    str = '0.' + getZeroString(-e - 1) + str;
	    if (sd && (k = sd - len) > 0) str += getZeroString(k);
	  } else if (e >= len) {
	    str += getZeroString(e + 1 - len);
	    if (sd && (k = sd - e - 1) > 0) str = str + '.' + getZeroString(k);
	  } else {
	    if ((k = e + 1) < len) str = str.slice(0, k) + '.' + str.slice(k);
	    if (sd && (k = sd - len) > 0) {
	      if (e + 1 === len) str += '.';
	      str += getZeroString(k);
	    }
	  }

	  return str;
	}


	// Calculate the base 10 exponent from the base 1e7 exponent.
	function getBase10Exponent(digits, e) {
	  var w = digits[0];

	  // Add the number of digits of the first word of the digits array.
	  for ( e *= LOG_BASE; w >= 10; w /= 10) e++;
	  return e;
	}


	function getLn10(Ctor, sd, pr) {
	  if (sd > LN10_PRECISION) {

	    // Reset global state in case the exception is caught.
	    external = true;
	    if (pr) Ctor.precision = pr;
	    throw Error(precisionLimitExceeded);
	  }
	  return finalise(new Ctor(LN10), sd, 1, true);
	}


	function getPi(Ctor, sd, rm) {
	  if (sd > PI_PRECISION) throw Error(precisionLimitExceeded);
	  return finalise(new Ctor(PI), sd, rm, true);
	}


	function getPrecision(digits) {
	  var w = digits.length - 1,
	    len = w * LOG_BASE + 1;

	  w = digits[w];

	  // If non-zero...
	  if (w) {

	    // Subtract the number of trailing zeros of the last word.
	    for (; w % 10 == 0; w /= 10) len--;

	    // Add the number of digits of the first word.
	    for (w = digits[0]; w >= 10; w /= 10) len++;
	  }

	  return len;
	}


	function getZeroString(k) {
	  var zs = '';
	  for (; k--;) zs += '0';
	  return zs;
	}


	/*
	 * Return a new Decimal whose value is the value of Decimal `x` to the power `n`, where `n` is an
	 * integer of type number.
	 *
	 * Implements 'exponentiation by squaring'. Called by `pow` and `parseOther`.
	 *
	 */
	function intPow(Ctor, x, n, pr) {
	  var isTruncated,
	    r = new Ctor(1),

	    // Max n of 9007199254740991 takes 53 loop iterations.
	    // Maximum digits array length; leaves [28, 34] guard digits.
	    k = Math.ceil(pr / LOG_BASE + 4);

	  external = false;

	  for (;;) {
	    if (n % 2) {
	      r = r.times(x);
	      if (truncate(r.d, k)) isTruncated = true;
	    }

	    n = mathfloor(n / 2);
	    if (n === 0) {

	      // To ensure correct rounding when r.d is truncated, increment the last word if it is zero.
	      n = r.d.length - 1;
	      if (isTruncated && r.d[n] === 0) ++r.d[n];
	      break;
	    }

	    x = x.times(x);
	    truncate(x.d, k);
	  }

	  external = true;

	  return r;
	}


	function isOdd(n) {
	  return n.d[n.d.length - 1] & 1;
	}


	/*
	 * Handle `max` and `min`. `ltgt` is 'lt' or 'gt'.
	 */
	function maxOrMin(Ctor, args, ltgt) {
	  var y,
	    x = new Ctor(args[0]),
	    i = 0;

	  for (; ++i < args.length;) {
	    y = new Ctor(args[i]);
	    if (!y.s) {
	      x = y;
	      break;
	    } else if (x[ltgt](y)) {
	      x = y;
	    }
	  }

	  return x;
	}


	/*
	 * Return a new Decimal whose value is the natural exponential of `x` rounded to `sd` significant
	 * digits.
	 *
	 * Taylor/Maclaurin series.
	 *
	 * exp(x) = x^0/0! + x^1/1! + x^2/2! + x^3/3! + ...
	 *
	 * Argument reduction:
	 *   Repeat x = x / 32, k += 5, until |x| < 0.1
	 *   exp(x) = exp(x / 2^k)^(2^k)
	 *
	 * Previously, the argument was initially reduced by
	 * exp(x) = exp(r) * 10^k  where r = x - k * ln10, k = floor(x / ln10)
	 * to first put r in the range [0, ln10], before dividing by 32 until |x| < 0.1, but this was
	 * found to be slower than just dividing repeatedly by 32 as above.
	 *
	 * Max integer argument: exp('20723265836946413') = 6.3e+9000000000000000
	 * Min integer argument: exp('-20723265836946411') = 1.2e-9000000000000000
	 * (Math object integer min/max: Math.exp(709) = 8.2e+307, Math.exp(-745) = 5e-324)
	 *
	 *  exp(Infinity)  = Infinity
	 *  exp(-Infinity) = 0
	 *  exp(NaN)       = NaN
	 *  exp(±0)        = 1
	 *
	 *  exp(x) is non-terminating for any finite, non-zero x.
	 *
	 *  The result will always be correctly rounded.
	 *
	 */
	function naturalExponential(x, sd) {
	  var denominator, guard, j, pow, sum, t, wpr,
	    rep = 0,
	    i = 0,
	    k = 0,
	    Ctor = x.constructor,
	    rm = Ctor.rounding,
	    pr = Ctor.precision;

	  // 0/NaN/Infinity?
	  if (!x.d || !x.d[0] || x.e > 17) {

	    return new Ctor(x.d
	      ? !x.d[0] ? 1 : x.s < 0 ? 0 : 1 / 0
	      : x.s ? x.s < 0 ? 0 : x : 0 / 0);
	  }

	  if (sd == null) {
	    external = false;
	    wpr = pr;
	  } else {
	    wpr = sd;
	  }

	  t = new Ctor(0.03125);

	  // while abs(x) >= 0.1
	  while (x.e > -2) {

	    // x = x / 2^5
	    x = x.times(t);
	    k += 5;
	  }

	  // Use 2 * log10(2^k) + 5 (empirically derived) to estimate the increase in precision
	  // necessary to ensure the first 4 rounding digits are correct.
	  guard = Math.log(mathpow(2, k)) / Math.LN10 * 2 + 5 | 0;
	  wpr += guard;
	  denominator = pow = sum = new Ctor(1);
	  Ctor.precision = wpr;

	  for (;;) {
	    pow = finalise(pow.times(x), wpr, 1);
	    denominator = denominator.times(++i);
	    t = sum.plus(divide(pow, denominator, wpr, 1));

	    if (digitsToString(t.d).slice(0, wpr) === digitsToString(sum.d).slice(0, wpr)) {
	      j = k;
	      while (j--) sum = finalise(sum.times(sum), wpr, 1);

	      // Check to see if the first 4 rounding digits are [49]999.
	      // If so, repeat the summation with a higher precision, otherwise
	      // e.g. with precision: 18, rounding: 1
	      // exp(18.404272462595034083567793919843761) = 98372560.1229999999 (should be 98372560.123)
	      // `wpr - guard` is the index of first rounding digit.
	      if (sd == null) {

	        if (rep < 3 && checkRoundingDigits(sum.d, wpr - guard, rm, rep)) {
	          Ctor.precision = wpr += 10;
	          denominator = pow = t = new Ctor(1);
	          i = 0;
	          rep++;
	        } else {
	          return finalise(sum, Ctor.precision = pr, rm, external = true);
	        }
	      } else {
	        Ctor.precision = pr;
	        return sum;
	      }
	    }

	    sum = t;
	  }
	}


	/*
	 * Return a new Decimal whose value is the natural logarithm of `x` rounded to `sd` significant
	 * digits.
	 *
	 *  ln(-n)        = NaN
	 *  ln(0)         = -Infinity
	 *  ln(-0)        = -Infinity
	 *  ln(1)         = 0
	 *  ln(Infinity)  = Infinity
	 *  ln(-Infinity) = NaN
	 *  ln(NaN)       = NaN
	 *
	 *  ln(n) (n != 1) is non-terminating.
	 *
	 */
	function naturalLogarithm(y, sd) {
	  var c, c0, denominator, e, numerator, rep, sum, t, wpr, x1, x2,
	    n = 1,
	    guard = 10,
	    x = y,
	    xd = x.d,
	    Ctor = x.constructor,
	    rm = Ctor.rounding,
	    pr = Ctor.precision;

	  // Is x negative or Infinity, NaN, 0 or 1?
	  if (x.s < 0 || !xd || !xd[0] || !x.e && xd[0] == 1 && xd.length == 1) {
	    return new Ctor(xd && !xd[0] ? -1 / 0 : x.s != 1 ? NaN : xd ? 0 : x);
	  }

	  if (sd == null) {
	    external = false;
	    wpr = pr;
	  } else {
	    wpr = sd;
	  }

	  Ctor.precision = wpr += guard;
	  c = digitsToString(xd);
	  c0 = c.charAt(0);

	  if (Math.abs(e = x.e) < 1.5e15) {

	    // Argument reduction.
	    // The series converges faster the closer the argument is to 1, so using
	    // ln(a^b) = b * ln(a),   ln(a) = ln(a^b) / b
	    // multiply the argument by itself until the leading digits of the significand are 7, 8, 9,
	    // 10, 11, 12 or 13, recording the number of multiplications so the sum of the series can
	    // later be divided by this number, then separate out the power of 10 using
	    // ln(a*10^b) = ln(a) + b*ln(10).

	    // max n is 21 (gives 0.9, 1.0 or 1.1) (9e15 / 21 = 4.2e14).
	    //while (c0 < 9 && c0 != 1 || c0 == 1 && c.charAt(1) > 1) {
	    // max n is 6 (gives 0.7 - 1.3)
	    while (c0 < 7 && c0 != 1 || c0 == 1 && c.charAt(1) > 3) {
	      x = x.times(y);
	      c = digitsToString(x.d);
	      c0 = c.charAt(0);
	      n++;
	    }

	    e = x.e;

	    if (c0 > 1) {
	      x = new Ctor('0.' + c);
	      e++;
	    } else {
	      x = new Ctor(c0 + '.' + c.slice(1));
	    }
	  } else {

	    // The argument reduction method above may result in overflow if the argument y is a massive
	    // number with exponent >= 1500000000000000 (9e15 / 6 = 1.5e15), so instead recall this
	    // function using ln(x*10^e) = ln(x) + e*ln(10).
	    t = getLn10(Ctor, wpr + 2, pr).times(e + '');
	    x = naturalLogarithm(new Ctor(c0 + '.' + c.slice(1)), wpr - guard).plus(t);
	    Ctor.precision = pr;

	    return sd == null ? finalise(x, pr, rm, external = true) : x;
	  }

	  // x1 is x reduced to a value near 1.
	  x1 = x;

	  // Taylor series.
	  // ln(y) = ln((1 + x)/(1 - x)) = 2(x + x^3/3 + x^5/5 + x^7/7 + ...)
	  // where x = (y - 1)/(y + 1)    (|x| < 1)
	  sum = numerator = x = divide(x.minus(1), x.plus(1), wpr, 1);
	  x2 = finalise(x.times(x), wpr, 1);
	  denominator = 3;

	  for (;;) {
	    numerator = finalise(numerator.times(x2), wpr, 1);
	    t = sum.plus(divide(numerator, new Ctor(denominator), wpr, 1));

	    if (digitsToString(t.d).slice(0, wpr) === digitsToString(sum.d).slice(0, wpr)) {
	      sum = sum.times(2);

	      // Reverse the argument reduction. Check that e is not 0 because, besides preventing an
	      // unnecessary calculation, -0 + 0 = +0 and to ensure correct rounding -0 needs to stay -0.
	      if (e !== 0) sum = sum.plus(getLn10(Ctor, wpr + 2, pr).times(e + ''));
	      sum = divide(sum, new Ctor(n), wpr, 1);

	      // Is rm > 3 and the first 4 rounding digits 4999, or rm < 4 (or the summation has
	      // been repeated previously) and the first 4 rounding digits 9999?
	      // If so, restart the summation with a higher precision, otherwise
	      // e.g. with precision: 12, rounding: 1
	      // ln(135520028.6126091714265381533) = 18.7246299999 when it should be 18.72463.
	      // `wpr - guard` is the index of first rounding digit.
	      if (sd == null) {
	        if (checkRoundingDigits(sum.d, wpr - guard, rm, rep)) {
	          Ctor.precision = wpr += guard;
	          t = numerator = x = divide(x1.minus(1), x1.plus(1), wpr, 1);
	          x2 = finalise(x.times(x), wpr, 1);
	          denominator = rep = 1;
	        } else {
	          return finalise(sum, Ctor.precision = pr, rm, external = true);
	        }
	      } else {
	        Ctor.precision = pr;
	        return sum;
	      }
	    }

	    sum = t;
	    denominator += 2;
	  }
	}


	// ±Infinity, NaN.
	function nonFiniteToString(x) {
	  // Unsigned.
	  return String(x.s * x.s / 0);
	}


	/*
	 * Parse the value of a new Decimal `x` from string `str`.
	 */
	function parseDecimal(x, str) {
	  var e, i, len;

	  // Decimal point?
	  if ((e = str.indexOf('.')) > -1) str = str.replace('.', '');

	  // Exponential form?
	  if ((i = str.search(/e/i)) > 0) {

	    // Determine exponent.
	    if (e < 0) e = i;
	    e += +str.slice(i + 1);
	    str = str.substring(0, i);
	  } else if (e < 0) {

	    // Integer.
	    e = str.length;
	  }

	  // Determine leading zeros.
	  for (i = 0; str.charCodeAt(i) === 48; i++);

	  // Determine trailing zeros.
	  for (len = str.length; str.charCodeAt(len - 1) === 48; --len);
	  str = str.slice(i, len);

	  if (str) {
	    len -= i;
	    x.e = e = e - i - 1;
	    x.d = [];

	    // Transform base

	    // e is the base 10 exponent.
	    // i is where to slice str to get the first word of the digits array.
	    i = (e + 1) % LOG_BASE;
	    if (e < 0) i += LOG_BASE;

	    if (i < len) {
	      if (i) x.d.push(+str.slice(0, i));
	      for (len -= LOG_BASE; i < len;) x.d.push(+str.slice(i, i += LOG_BASE));
	      str = str.slice(i);
	      i = LOG_BASE - str.length;
	    } else {
	      i -= len;
	    }

	    for (; i--;) str += '0';
	    x.d.push(+str);

	    if (external) {

	      // Overflow?
	      if (x.e > x.constructor.maxE) {

	        // Infinity.
	        x.d = null;
	        x.e = NaN;

	      // Underflow?
	      } else if (x.e < x.constructor.minE) {

	        // Zero.
	        x.e = 0;
	        x.d = [0];
	        // x.constructor.underflow = true;
	      } // else x.constructor.underflow = false;
	    }
	  } else {

	    // Zero.
	    x.e = 0;
	    x.d = [0];
	  }

	  return x;
	}


	/*
	 * Parse the value of a new Decimal `x` from a string `str`, which is not a decimal value.
	 */
	function parseOther(x, str) {
	  var base, Ctor, divisor, i, isFloat, len, p, xd, xe;

	  if (str.indexOf('_') > -1) {
	    str = str.replace(/(\d)_(?=\d)/g, '$1');
	    if (isDecimal.test(str)) return parseDecimal(x, str);
	  } else if (str === 'Infinity' || str === 'NaN') {
	    if (!+str) x.s = NaN;
	    x.e = NaN;
	    x.d = null;
	    return x;
	  }

	  if (isHex.test(str))  {
	    base = 16;
	    str = str.toLowerCase();
	  } else if (isBinary.test(str))  {
	    base = 2;
	  } else if (isOctal.test(str))  {
	    base = 8;
	  } else {
	    throw Error(invalidArgument + str);
	  }

	  // Is there a binary exponent part?
	  i = str.search(/p/i);

	  if (i > 0) {
	    p = +str.slice(i + 1);
	    str = str.substring(2, i);
	  } else {
	    str = str.slice(2);
	  }

	  // Convert `str` as an integer then divide the result by `base` raised to a power such that the
	  // fraction part will be restored.
	  i = str.indexOf('.');
	  isFloat = i >= 0;
	  Ctor = x.constructor;

	  if (isFloat) {
	    str = str.replace('.', '');
	    len = str.length;
	    i = len - i;

	    // log[10](16) = 1.2041... , log[10](88) = 1.9444....
	    divisor = intPow(Ctor, new Ctor(base), i, i * 2);
	  }

	  xd = convertBase(str, base, BASE);
	  xe = xd.length - 1;

	  // Remove trailing zeros.
	  for (i = xe; xd[i] === 0; --i) xd.pop();
	  if (i < 0) return new Ctor(x.s * 0);
	  x.e = getBase10Exponent(xd, xe);
	  x.d = xd;
	  external = false;

	  // At what precision to perform the division to ensure exact conversion?
	  // maxDecimalIntegerPartDigitCount = ceil(log[10](b) * otherBaseIntegerPartDigitCount)
	  // log[10](2) = 0.30103, log[10](8) = 0.90309, log[10](16) = 1.20412
	  // E.g. ceil(1.2 * 3) = 4, so up to 4 decimal digits are needed to represent 3 hex int digits.
	  // maxDecimalFractionPartDigitCount = {Hex:4|Oct:3|Bin:1} * otherBaseFractionPartDigitCount
	  // Therefore using 4 * the number of digits of str will always be enough.
	  if (isFloat) x = divide(x, divisor, len * 4);

	  // Multiply by the binary exponent part if present.
	  if (p) x = x.times(Math.abs(p) < 54 ? mathpow(2, p) : Decimal.pow(2, p));
	  external = true;

	  return x;
	}


	/*
	 * sin(x) = x - x^3/3! + x^5/5! - ...
	 * |x| < pi/2
	 *
	 */
	function sine(Ctor, x) {
	  var k,
	    len = x.d.length;

	  if (len < 3) {
	    return x.isZero() ? x : taylorSeries(Ctor, 2, x, x);
	  }

	  // Argument reduction: sin(5x) = 16*sin^5(x) - 20*sin^3(x) + 5*sin(x)
	  // i.e. sin(x) = 16*sin^5(x/5) - 20*sin^3(x/5) + 5*sin(x/5)
	  // and  sin(x) = sin(x/5)(5 + sin^2(x/5)(16sin^2(x/5) - 20))

	  // Estimate the optimum number of times to use the argument reduction.
	  k = 1.4 * Math.sqrt(len);
	  k = k > 16 ? 16 : k | 0;

	  x = x.times(1 / tinyPow(5, k));
	  x = taylorSeries(Ctor, 2, x, x);

	  // Reverse argument reduction
	  var sin2_x,
	    d5 = new Ctor(5),
	    d16 = new Ctor(16),
	    d20 = new Ctor(20);
	  for (; k--;) {
	    sin2_x = x.times(x);
	    x = x.times(d5.plus(sin2_x.times(d16.times(sin2_x).minus(d20))));
	  }

	  return x;
	}


	// Calculate Taylor series for `cos`, `cosh`, `sin` and `sinh`.
	function taylorSeries(Ctor, n, x, y, isHyperbolic) {
	  var j, t, u, x2,
	    pr = Ctor.precision,
	    k = Math.ceil(pr / LOG_BASE);

	  external = false;
	  x2 = x.times(x);
	  u = new Ctor(y);

	  for (;;) {
	    t = divide(u.times(x2), new Ctor(n++ * n++), pr, 1);
	    u = isHyperbolic ? y.plus(t) : y.minus(t);
	    y = divide(t.times(x2), new Ctor(n++ * n++), pr, 1);
	    t = u.plus(y);

	    if (t.d[k] !== void 0) {
	      for (j = k; t.d[j] === u.d[j] && j--;);
	      if (j == -1) break;
	    }

	    j = u;
	    u = y;
	    y = t;
	    t = j;
	  }

	  external = true;
	  t.d.length = k + 1;

	  return t;
	}


	// Exponent e must be positive and non-zero.
	function tinyPow(b, e) {
	  var n = b;
	  while (--e) n *= b;
	  return n;
	}


	// Return the absolute value of `x` reduced to less than or equal to half pi.
	function toLessThanHalfPi(Ctor, x) {
	  var t,
	    isNeg = x.s < 0,
	    pi = getPi(Ctor, Ctor.precision, 1),
	    halfPi = pi.times(0.5);

	  x = x.abs();

	  if (x.lte(halfPi)) {
	    quadrant = isNeg ? 4 : 1;
	    return x;
	  }

	  t = x.divToInt(pi);

	  if (t.isZero()) {
	    quadrant = isNeg ? 3 : 2;
	  } else {
	    x = x.minus(t.times(pi));

	    // 0 <= x < pi
	    if (x.lte(halfPi)) {
	      quadrant = isOdd(t) ? (isNeg ? 2 : 3) : (isNeg ? 4 : 1);
	      return x;
	    }

	    quadrant = isOdd(t) ? (isNeg ? 1 : 4) : (isNeg ? 3 : 2);
	  }

	  return x.minus(pi).abs();
	}


	/*
	 * Return the value of Decimal `x` as a string in base `baseOut`.
	 *
	 * If the optional `sd` argument is present include a binary exponent suffix.
	 */
	function toStringBinary(x, baseOut, sd, rm) {
	  var base, e, i, k, len, roundUp, str, xd, y,
	    Ctor = x.constructor,
	    isExp = sd !== void 0;

	  if (isExp) {
	    checkInt32(sd, 1, MAX_DIGITS);
	    if (rm === void 0) rm = Ctor.rounding;
	    else checkInt32(rm, 0, 8);
	  } else {
	    sd = Ctor.precision;
	    rm = Ctor.rounding;
	  }

	  if (!x.isFinite()) {
	    str = nonFiniteToString(x);
	  } else {
	    str = finiteToString(x);
	    i = str.indexOf('.');

	    // Use exponential notation according to `toExpPos` and `toExpNeg`? No, but if required:
	    // maxBinaryExponent = floor((decimalExponent + 1) * log[2](10))
	    // minBinaryExponent = floor(decimalExponent * log[2](10))
	    // log[2](10) = 3.321928094887362347870319429489390175864

	    if (isExp) {
	      base = 2;
	      if (baseOut == 16) {
	        sd = sd * 4 - 3;
	      } else if (baseOut == 8) {
	        sd = sd * 3 - 2;
	      }
	    } else {
	      base = baseOut;
	    }

	    // Convert the number as an integer then divide the result by its base raised to a power such
	    // that the fraction part will be restored.

	    // Non-integer.
	    if (i >= 0) {
	      str = str.replace('.', '');
	      y = new Ctor(1);
	      y.e = str.length - i;
	      y.d = convertBase(finiteToString(y), 10, base);
	      y.e = y.d.length;
	    }

	    xd = convertBase(str, 10, base);
	    e = len = xd.length;

	    // Remove trailing zeros.
	    for (; xd[--len] == 0;) xd.pop();

	    if (!xd[0]) {
	      str = isExp ? '0p+0' : '0';
	    } else {
	      if (i < 0) {
	        e--;
	      } else {
	        x = new Ctor(x);
	        x.d = xd;
	        x.e = e;
	        x = divide(x, y, sd, rm, 0, base);
	        xd = x.d;
	        e = x.e;
	        roundUp = inexact;
	      }

	      // The rounding digit, i.e. the digit after the digit that may be rounded up.
	      i = xd[sd];
	      k = base / 2;
	      roundUp = roundUp || xd[sd + 1] !== void 0;

	      roundUp = rm < 4
	        ? (i !== void 0 || roundUp) && (rm === 0 || rm === (x.s < 0 ? 3 : 2))
	        : i > k || i === k && (rm === 4 || roundUp || rm === 6 && xd[sd - 1] & 1 ||
	          rm === (x.s < 0 ? 8 : 7));

	      xd.length = sd;

	      if (roundUp) {

	        // Rounding up may mean the previous digit has to be rounded up and so on.
	        for (; ++xd[--sd] > base - 1;) {
	          xd[sd] = 0;
	          if (!sd) {
	            ++e;
	            xd.unshift(1);
	          }
	        }
	      }

	      // Determine trailing zeros.
	      for (len = xd.length; !xd[len - 1]; --len);

	      // E.g. [4, 11, 15] becomes 4bf.
	      for (i = 0, str = ''; i < len; i++) str += NUMERALS.charAt(xd[i]);

	      // Add binary exponent suffix?
	      if (isExp) {
	        if (len > 1) {
	          if (baseOut == 16 || baseOut == 8) {
	            i = baseOut == 16 ? 4 : 3;
	            for (--len; len % i; len++) str += '0';
	            xd = convertBase(str, base, baseOut);
	            for (len = xd.length; !xd[len - 1]; --len);

	            // xd[0] will always be be 1
	            for (i = 1, str = '1.'; i < len; i++) str += NUMERALS.charAt(xd[i]);
	          } else {
	            str = str.charAt(0) + '.' + str.slice(1);
	          }
	        }

	        str =  str + (e < 0 ? 'p' : 'p+') + e;
	      } else if (e < 0) {
	        for (; ++e;) str = '0' + str;
	        str = '0.' + str;
	      } else {
	        if (++e > len) for (e -= len; e-- ;) str += '0';
	        else if (e < len) str = str.slice(0, e) + '.' + str.slice(e);
	      }
	    }

	    str = (baseOut == 16 ? '0x' : baseOut == 2 ? '0b' : baseOut == 8 ? '0o' : '') + str;
	  }

	  return x.s < 0 ? '-' + str : str;
	}


	// Does not strip trailing zeros.
	function truncate(arr, len) {
	  if (arr.length > len) {
	    arr.length = len;
	    return true;
	  }
	}


	// Decimal methods


	/*
	 *  abs
	 *  acos
	 *  acosh
	 *  add
	 *  asin
	 *  asinh
	 *  atan
	 *  atanh
	 *  atan2
	 *  cbrt
	 *  ceil
	 *  clamp
	 *  clone
	 *  config
	 *  cos
	 *  cosh
	 *  div
	 *  exp
	 *  floor
	 *  hypot
	 *  ln
	 *  log
	 *  log2
	 *  log10
	 *  max
	 *  min
	 *  mod
	 *  mul
	 *  pow
	 *  random
	 *  round
	 *  set
	 *  sign
	 *  sin
	 *  sinh
	 *  sqrt
	 *  sub
	 *  sum
	 *  tan
	 *  tanh
	 *  trunc
	 */


	/*
	 * Return a new Decimal whose value is the absolute value of `x`.
	 *
	 * x {number|string|Decimal}
	 *
	 */
	function abs(x) {
	  return new this(x).abs();
	}


	/*
	 * Return a new Decimal whose value is the arccosine in radians of `x`.
	 *
	 * x {number|string|Decimal}
	 *
	 */
	function acos(x) {
	  return new this(x).acos();
	}


	/*
	 * Return a new Decimal whose value is the inverse of the hyperbolic cosine of `x`, rounded to
	 * `precision` significant digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal} A value in radians.
	 *
	 */
	function acosh(x) {
	  return new this(x).acosh();
	}


	/*
	 * Return a new Decimal whose value is the sum of `x` and `y`, rounded to `precision` significant
	 * digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal}
	 * y {number|string|Decimal}
	 *
	 */
	function add(x, y) {
	  return new this(x).plus(y);
	}


	/*
	 * Return a new Decimal whose value is the arcsine in radians of `x`, rounded to `precision`
	 * significant digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal}
	 *
	 */
	function asin(x) {
	  return new this(x).asin();
	}


	/*
	 * Return a new Decimal whose value is the inverse of the hyperbolic sine of `x`, rounded to
	 * `precision` significant digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal} A value in radians.
	 *
	 */
	function asinh(x) {
	  return new this(x).asinh();
	}


	/*
	 * Return a new Decimal whose value is the arctangent in radians of `x`, rounded to `precision`
	 * significant digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal}
	 *
	 */
	function atan(x) {
	  return new this(x).atan();
	}


	/*
	 * Return a new Decimal whose value is the inverse of the hyperbolic tangent of `x`, rounded to
	 * `precision` significant digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal} A value in radians.
	 *
	 */
	function atanh(x) {
	  return new this(x).atanh();
	}


	/*
	 * Return a new Decimal whose value is the arctangent in radians of `y/x` in the range -pi to pi
	 * (inclusive), rounded to `precision` significant digits using rounding mode `rounding`.
	 *
	 * Domain: [-Infinity, Infinity]
	 * Range: [-pi, pi]
	 *
	 * y {number|string|Decimal} The y-coordinate.
	 * x {number|string|Decimal} The x-coordinate.
	 *
	 * atan2(±0, -0)               = ±pi
	 * atan2(±0, +0)               = ±0
	 * atan2(±0, -x)               = ±pi for x > 0
	 * atan2(±0, x)                = ±0 for x > 0
	 * atan2(-y, ±0)               = -pi/2 for y > 0
	 * atan2(y, ±0)                = pi/2 for y > 0
	 * atan2(±y, -Infinity)        = ±pi for finite y > 0
	 * atan2(±y, +Infinity)        = ±0 for finite y > 0
	 * atan2(±Infinity, x)         = ±pi/2 for finite x
	 * atan2(±Infinity, -Infinity) = ±3*pi/4
	 * atan2(±Infinity, +Infinity) = ±pi/4
	 * atan2(NaN, x) = NaN
	 * atan2(y, NaN) = NaN
	 *
	 */
	function atan2(y, x) {
	  y = new this(y);
	  x = new this(x);
	  var r,
	    pr = this.precision,
	    rm = this.rounding,
	    wpr = pr + 4;

	  // Either NaN
	  if (!y.s || !x.s) {
	    r = new this(NaN);

	  // Both ±Infinity
	  } else if (!y.d && !x.d) {
	    r = getPi(this, wpr, 1).times(x.s > 0 ? 0.25 : 0.75);
	    r.s = y.s;

	  // x is ±Infinity or y is ±0
	  } else if (!x.d || y.isZero()) {
	    r = x.s < 0 ? getPi(this, pr, rm) : new this(0);
	    r.s = y.s;

	  // y is ±Infinity or x is ±0
	  } else if (!y.d || x.isZero()) {
	    r = getPi(this, wpr, 1).times(0.5);
	    r.s = y.s;

	  // Both non-zero and finite
	  } else if (x.s < 0) {
	    this.precision = wpr;
	    this.rounding = 1;
	    r = this.atan(divide(y, x, wpr, 1));
	    x = getPi(this, wpr, 1);
	    this.precision = pr;
	    this.rounding = rm;
	    r = y.s < 0 ? r.minus(x) : r.plus(x);
	  } else {
	    r = this.atan(divide(y, x, wpr, 1));
	  }

	  return r;
	}


	/*
	 * Return a new Decimal whose value is the cube root of `x`, rounded to `precision` significant
	 * digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal}
	 *
	 */
	function cbrt(x) {
	  return new this(x).cbrt();
	}


	/*
	 * Return a new Decimal whose value is `x` rounded to an integer using `ROUND_CEIL`.
	 *
	 * x {number|string|Decimal}
	 *
	 */
	function ceil(x) {
	  return finalise(x = new this(x), x.e + 1, 2);
	}


	/*
	 * Return a new Decimal whose value is `x` clamped to the range delineated by `min` and `max`.
	 *
	 * x {number|string|Decimal}
	 * min {number|string|Decimal}
	 * max {number|string|Decimal}
	 *
	 */
	function clamp$1(x, min, max) {
	  return new this(x).clamp(min, max);
	}


	/*
	 * Configure global settings for a Decimal constructor.
	 *
	 * `obj` is an object with one or more of the following properties,
	 *
	 *   precision  {number}
	 *   rounding   {number}
	 *   toExpNeg   {number}
	 *   toExpPos   {number}
	 *   maxE       {number}
	 *   minE       {number}
	 *   modulo     {number}
	 *   crypto     {boolean|number}
	 *   defaults   {true}
	 *
	 * E.g. Decimal.config({ precision: 20, rounding: 4 })
	 *
	 */
	function config(obj) {
	  if (!obj || typeof obj !== 'object') throw Error(decimalError + 'Object expected');
	  var i, p, v,
	    useDefaults = obj.defaults === true,
	    ps = [
	      'precision', 1, MAX_DIGITS,
	      'rounding', 0, 8,
	      'toExpNeg', -EXP_LIMIT, 0,
	      'toExpPos', 0, EXP_LIMIT,
	      'maxE', 0, EXP_LIMIT,
	      'minE', -EXP_LIMIT, 0,
	      'modulo', 0, 9
	    ];

	  for (i = 0; i < ps.length; i += 3) {
	    if (p = ps[i], useDefaults) this[p] = DEFAULTS[p];
	    if ((v = obj[p]) !== void 0) {
	      if (mathfloor(v) === v && v >= ps[i + 1] && v <= ps[i + 2]) this[p] = v;
	      else throw Error(invalidArgument + p + ': ' + v);
	    }
	  }

	  if (p = 'crypto', useDefaults) this[p] = DEFAULTS[p];
	  if ((v = obj[p]) !== void 0) {
	    if (v === true || v === false || v === 0 || v === 1) {
	      if (v) {
	        if (typeof crypto != 'undefined' && crypto &&
	          (crypto.getRandomValues || crypto.randomBytes)) {
	          this[p] = true;
	        } else {
	          throw Error(cryptoUnavailable);
	        }
	      } else {
	        this[p] = false;
	      }
	    } else {
	      throw Error(invalidArgument + p + ': ' + v);
	    }
	  }

	  return this;
	}


	/*
	 * Return a new Decimal whose value is the cosine of `x`, rounded to `precision` significant
	 * digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal} A value in radians.
	 *
	 */
	function cos(x) {
	  return new this(x).cos();
	}


	/*
	 * Return a new Decimal whose value is the hyperbolic cosine of `x`, rounded to precision
	 * significant digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal} A value in radians.
	 *
	 */
	function cosh(x) {
	  return new this(x).cosh();
	}


	/*
	 * Create and return a Decimal constructor with the same configuration properties as this Decimal
	 * constructor.
	 *
	 */
	function clone(obj) {
	  var i, p, ps;

	  /*
	   * The Decimal constructor and exported function.
	   * Return a new Decimal instance.
	   *
	   * v {number|string|Decimal} A numeric value.
	   *
	   */
	  function Decimal(v) {
	    var e, i, t,
	      x = this;

	    // Decimal called without new.
	    if (!(x instanceof Decimal)) return new Decimal(v);

	    // Retain a reference to this Decimal constructor, and shadow Decimal.prototype.constructor
	    // which points to Object.
	    x.constructor = Decimal;

	    // Duplicate.
	    if (isDecimalInstance(v)) {
	      x.s = v.s;

	      if (external) {
	        if (!v.d || v.e > Decimal.maxE) {

	          // Infinity.
	          x.e = NaN;
	          x.d = null;
	        } else if (v.e < Decimal.minE) {

	          // Zero.
	          x.e = 0;
	          x.d = [0];
	        } else {
	          x.e = v.e;
	          x.d = v.d.slice();
	        }
	      } else {
	        x.e = v.e;
	        x.d = v.d ? v.d.slice() : v.d;
	      }

	      return;
	    }

	    t = typeof v;

	    if (t === 'number') {
	      if (v === 0) {
	        x.s = 1 / v < 0 ? -1 : 1;
	        x.e = 0;
	        x.d = [0];
	        return;
	      }

	      if (v < 0) {
	        v = -v;
	        x.s = -1;
	      } else {
	        x.s = 1;
	      }

	      // Fast path for small integers.
	      if (v === ~~v && v < 1e7) {
	        for (e = 0, i = v; i >= 10; i /= 10) e++;

	        if (external) {
	          if (e > Decimal.maxE) {
	            x.e = NaN;
	            x.d = null;
	          } else if (e < Decimal.minE) {
	            x.e = 0;
	            x.d = [0];
	          } else {
	            x.e = e;
	            x.d = [v];
	          }
	        } else {
	          x.e = e;
	          x.d = [v];
	        }

	        return;

	      // Infinity, NaN.
	      } else if (v * 0 !== 0) {
	        if (!v) x.s = NaN;
	        x.e = NaN;
	        x.d = null;
	        return;
	      }

	      return parseDecimal(x, v.toString());

	    } else if (t !== 'string') {
	      throw Error(invalidArgument + v);
	    }

	    // Minus sign?
	    if ((i = v.charCodeAt(0)) === 45) {
	      v = v.slice(1);
	      x.s = -1;
	    } else {
	      // Plus sign?
	      if (i === 43) v = v.slice(1);
	      x.s = 1;
	    }

	    return isDecimal.test(v) ? parseDecimal(x, v) : parseOther(x, v);
	  }

	  Decimal.prototype = P;

	  Decimal.ROUND_UP = 0;
	  Decimal.ROUND_DOWN = 1;
	  Decimal.ROUND_CEIL = 2;
	  Decimal.ROUND_FLOOR = 3;
	  Decimal.ROUND_HALF_UP = 4;
	  Decimal.ROUND_HALF_DOWN = 5;
	  Decimal.ROUND_HALF_EVEN = 6;
	  Decimal.ROUND_HALF_CEIL = 7;
	  Decimal.ROUND_HALF_FLOOR = 8;
	  Decimal.EUCLID = 9;

	  Decimal.config = Decimal.set = config;
	  Decimal.clone = clone;
	  Decimal.isDecimal = isDecimalInstance;

	  Decimal.abs = abs;
	  Decimal.acos = acos;
	  Decimal.acosh = acosh;        // ES6
	  Decimal.add = add;
	  Decimal.asin = asin;
	  Decimal.asinh = asinh;        // ES6
	  Decimal.atan = atan;
	  Decimal.atanh = atanh;        // ES6
	  Decimal.atan2 = atan2;
	  Decimal.cbrt = cbrt;          // ES6
	  Decimal.ceil = ceil;
	  Decimal.clamp = clamp$1;
	  Decimal.cos = cos;
	  Decimal.cosh = cosh;          // ES6
	  Decimal.div = div;
	  Decimal.exp = exp;
	  Decimal.floor = floor;
	  Decimal.hypot = hypot;        // ES6
	  Decimal.ln = ln;
	  Decimal.log = log;
	  Decimal.log10 = log10;        // ES6
	  Decimal.log2 = log2;          // ES6
	  Decimal.max = max;
	  Decimal.min = min;
	  Decimal.mod = mod;
	  Decimal.mul = mul;
	  Decimal.pow = pow;
	  Decimal.random = random$1;
	  Decimal.round = round;
	  Decimal.sign = sign;          // ES6
	  Decimal.sin = sin;
	  Decimal.sinh = sinh;          // ES6
	  Decimal.sqrt = sqrt;
	  Decimal.sub = sub;
	  Decimal.sum = sum;
	  Decimal.tan = tan;
	  Decimal.tanh = tanh;          // ES6
	  Decimal.trunc = trunc;        // ES6

	  if (obj === void 0) obj = {};
	  if (obj) {
	    if (obj.defaults !== true) {
	      ps = ['precision', 'rounding', 'toExpNeg', 'toExpPos', 'maxE', 'minE', 'modulo', 'crypto'];
	      for (i = 0; i < ps.length;) if (!obj.hasOwnProperty(p = ps[i++])) obj[p] = this[p];
	    }
	  }

	  Decimal.config(obj);

	  return Decimal;
	}


	/*
	 * Return a new Decimal whose value is `x` divided by `y`, rounded to `precision` significant
	 * digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal}
	 * y {number|string|Decimal}
	 *
	 */
	function div(x, y) {
	  return new this(x).div(y);
	}


	/*
	 * Return a new Decimal whose value is the natural exponential of `x`, rounded to `precision`
	 * significant digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal} The power to which to raise the base of the natural log.
	 *
	 */
	function exp(x) {
	  return new this(x).exp();
	}


	/*
	 * Return a new Decimal whose value is `x` round to an integer using `ROUND_FLOOR`.
	 *
	 * x {number|string|Decimal}
	 *
	 */
	function floor(x) {
	  return finalise(x = new this(x), x.e + 1, 3);
	}


	/*
	 * Return a new Decimal whose value is the square root of the sum of the squares of the arguments,
	 * rounded to `precision` significant digits using rounding mode `rounding`.
	 *
	 * hypot(a, b, ...) = sqrt(a^2 + b^2 + ...)
	 *
	 * arguments {number|string|Decimal}
	 *
	 */
	function hypot() {
	  var i, n,
	    t = new this(0);

	  external = false;

	  for (i = 0; i < arguments.length;) {
	    n = new this(arguments[i++]);
	    if (!n.d) {
	      if (n.s) {
	        external = true;
	        return new this(1 / 0);
	      }
	      t = n;
	    } else if (t.d) {
	      t = t.plus(n.times(n));
	    }
	  }

	  external = true;

	  return t.sqrt();
	}


	/*
	 * Return true if object is a Decimal instance (where Decimal is any Decimal constructor),
	 * otherwise return false.
	 *
	 */
	function isDecimalInstance(obj) {
	  return obj instanceof Decimal || obj && obj.toStringTag === tag || false;
	}


	/*
	 * Return a new Decimal whose value is the natural logarithm of `x`, rounded to `precision`
	 * significant digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal}
	 *
	 */
	function ln(x) {
	  return new this(x).ln();
	}


	/*
	 * Return a new Decimal whose value is the log of `x` to the base `y`, or to base 10 if no base
	 * is specified, rounded to `precision` significant digits using rounding mode `rounding`.
	 *
	 * log[y](x)
	 *
	 * x {number|string|Decimal} The argument of the logarithm.
	 * y {number|string|Decimal} The base of the logarithm.
	 *
	 */
	function log(x, y) {
	  return new this(x).log(y);
	}


	/*
	 * Return a new Decimal whose value is the base 2 logarithm of `x`, rounded to `precision`
	 * significant digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal}
	 *
	 */
	function log2(x) {
	  return new this(x).log(2);
	}


	/*
	 * Return a new Decimal whose value is the base 10 logarithm of `x`, rounded to `precision`
	 * significant digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal}
	 *
	 */
	function log10(x) {
	  return new this(x).log(10);
	}


	/*
	 * Return a new Decimal whose value is the maximum of the arguments.
	 *
	 * arguments {number|string|Decimal}
	 *
	 */
	function max() {
	  return maxOrMin(this, arguments, 'lt');
	}


	/*
	 * Return a new Decimal whose value is the minimum of the arguments.
	 *
	 * arguments {number|string|Decimal}
	 *
	 */
	function min() {
	  return maxOrMin(this, arguments, 'gt');
	}


	/*
	 * Return a new Decimal whose value is `x` modulo `y`, rounded to `precision` significant digits
	 * using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal}
	 * y {number|string|Decimal}
	 *
	 */
	function mod(x, y) {
	  return new this(x).mod(y);
	}


	/*
	 * Return a new Decimal whose value is `x` multiplied by `y`, rounded to `precision` significant
	 * digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal}
	 * y {number|string|Decimal}
	 *
	 */
	function mul(x, y) {
	  return new this(x).mul(y);
	}


	/*
	 * Return a new Decimal whose value is `x` raised to the power `y`, rounded to precision
	 * significant digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal} The base.
	 * y {number|string|Decimal} The exponent.
	 *
	 */
	function pow(x, y) {
	  return new this(x).pow(y);
	}


	/*
	 * Returns a new Decimal with a random value equal to or greater than 0 and less than 1, and with
	 * `sd`, or `Decimal.precision` if `sd` is omitted, significant digits (or less if trailing zeros
	 * are produced).
	 *
	 * [sd] {number} Significant digits. Integer, 0 to MAX_DIGITS inclusive.
	 *
	 */
	function random$1(sd) {
	  var d, e, k, n,
	    i = 0,
	    r = new this(1),
	    rd = [];

	  if (sd === void 0) sd = this.precision;
	  else checkInt32(sd, 1, MAX_DIGITS);

	  k = Math.ceil(sd / LOG_BASE);

	  if (!this.crypto) {
	    for (; i < k;) rd[i++] = Math.random() * 1e7 | 0;

	  // Browsers supporting crypto.getRandomValues.
	  } else if (crypto.getRandomValues) {
	    d = crypto.getRandomValues(new Uint32Array(k));

	    for (; i < k;) {
	      n = d[i];

	      // 0 <= n < 4294967296
	      // Probability n >= 4.29e9, is 4967296 / 4294967296 = 0.00116 (1 in 865).
	      if (n >= 4.29e9) {
	        d[i] = crypto.getRandomValues(new Uint32Array(1))[0];
	      } else {

	        // 0 <= n <= 4289999999
	        // 0 <= (n % 1e7) <= 9999999
	        rd[i++] = n % 1e7;
	      }
	    }

	  // Node.js supporting crypto.randomBytes.
	  } else if (crypto.randomBytes) {

	    // buffer
	    d = crypto.randomBytes(k *= 4);

	    for (; i < k;) {

	      // 0 <= n < 2147483648
	      n = d[i] + (d[i + 1] << 8) + (d[i + 2] << 16) + ((d[i + 3] & 0x7f) << 24);

	      // Probability n >= 2.14e9, is 7483648 / 2147483648 = 0.0035 (1 in 286).
	      if (n >= 2.14e9) {
	        crypto.randomBytes(4).copy(d, i);
	      } else {

	        // 0 <= n <= 2139999999
	        // 0 <= (n % 1e7) <= 9999999
	        rd.push(n % 1e7);
	        i += 4;
	      }
	    }

	    i = k / 4;
	  } else {
	    throw Error(cryptoUnavailable);
	  }

	  k = rd[--i];
	  sd %= LOG_BASE;

	  // Convert trailing digits to zeros according to sd.
	  if (k && sd) {
	    n = mathpow(10, LOG_BASE - sd);
	    rd[i] = (k / n | 0) * n;
	  }

	  // Remove trailing words which are zero.
	  for (; rd[i] === 0; i--) rd.pop();

	  // Zero?
	  if (i < 0) {
	    e = 0;
	    rd = [0];
	  } else {
	    e = -1;

	    // Remove leading words which are zero and adjust exponent accordingly.
	    for (; rd[0] === 0; e -= LOG_BASE) rd.shift();

	    // Count the digits of the first word of rd to determine leading zeros.
	    for (k = 1, n = rd[0]; n >= 10; n /= 10) k++;

	    // Adjust the exponent for leading zeros of the first word of rd.
	    if (k < LOG_BASE) e -= LOG_BASE - k;
	  }

	  r.e = e;
	  r.d = rd;

	  return r;
	}


	/*
	 * Return a new Decimal whose value is `x` rounded to an integer using rounding mode `rounding`.
	 *
	 * To emulate `Math.round`, set rounding to 7 (ROUND_HALF_CEIL).
	 *
	 * x {number|string|Decimal}
	 *
	 */
	function round(x) {
	  return finalise(x = new this(x), x.e + 1, this.rounding);
	}


	/*
	 * Return
	 *   1    if x > 0,
	 *  -1    if x < 0,
	 *   0    if x is 0,
	 *  -0    if x is -0,
	 *   NaN  otherwise
	 *
	 * x {number|string|Decimal}
	 *
	 */
	function sign(x) {
	  x = new this(x);
	  return x.d ? (x.d[0] ? x.s : 0 * x.s) : x.s || NaN;
	}


	/*
	 * Return a new Decimal whose value is the sine of `x`, rounded to `precision` significant digits
	 * using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal} A value in radians.
	 *
	 */
	function sin(x) {
	  return new this(x).sin();
	}


	/*
	 * Return a new Decimal whose value is the hyperbolic sine of `x`, rounded to `precision`
	 * significant digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal} A value in radians.
	 *
	 */
	function sinh(x) {
	  return new this(x).sinh();
	}


	/*
	 * Return a new Decimal whose value is the square root of `x`, rounded to `precision` significant
	 * digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal}
	 *
	 */
	function sqrt(x) {
	  return new this(x).sqrt();
	}


	/*
	 * Return a new Decimal whose value is `x` minus `y`, rounded to `precision` significant digits
	 * using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal}
	 * y {number|string|Decimal}
	 *
	 */
	function sub(x, y) {
	  return new this(x).sub(y);
	}


	/*
	 * Return a new Decimal whose value is the sum of the arguments, rounded to `precision`
	 * significant digits using rounding mode `rounding`.
	 *
	 * Only the result is rounded, not the intermediate calculations.
	 *
	 * arguments {number|string|Decimal}
	 *
	 */
	function sum() {
	  var i = 0,
	    args = arguments,
	    x = new this(args[i]);

	  external = false;
	  for (; x.s && ++i < args.length;) x = x.plus(args[i]);
	  external = true;

	  return finalise(x, this.precision, this.rounding);
	}


	/*
	 * Return a new Decimal whose value is the tangent of `x`, rounded to `precision` significant
	 * digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal} A value in radians.
	 *
	 */
	function tan(x) {
	  return new this(x).tan();
	}


	/*
	 * Return a new Decimal whose value is the hyperbolic tangent of `x`, rounded to `precision`
	 * significant digits using rounding mode `rounding`.
	 *
	 * x {number|string|Decimal} A value in radians.
	 *
	 */
	function tanh(x) {
	  return new this(x).tanh();
	}


	/*
	 * Return a new Decimal whose value is `x` truncated to an integer.
	 *
	 * x {number|string|Decimal}
	 *
	 */
	function trunc(x) {
	  return finalise(x = new this(x), x.e + 1, 1);
	}


	P[Symbol.for('nodejs.util.inspect.custom')] = P.toString;
	P[Symbol.toStringTag] = 'Decimal';

	// Create and configure initial Decimal constructor.
	var Decimal = P.constructor = clone(DEFAULTS);

	// Create the internal constants from their string values.
	LN10 = new Decimal(LN10);
	PI = new Decimal(PI);

	var Amount = {
	  view: node => {
	    let {
	      plain,
	      value,
	      currency,
	      ...attrs
	    } = node.attrs;
	    value = new Decimal(value);

	    if (value.greaterThanOrEqualTo(1)) {
	      value = value.toDecimalPlaces(2);
	    } else if (value.greaterThan(0)) {
	      value = value.toDecimalPlaces(-Math.floor(value.log()) + 2);
	    }

	    let valueString = value.toString();
	    let [integer, decimal] = valueString.split('.');
	    let formattedInteger = parseInt(integer).toLocaleString('en-US');
	    let formattedValue = formattedInteger;

	    if (decimal) {
	      formattedValue += `.${decimal}`;
	    }

	    if (plain) {
	      return c("span", {
	        class: `amount plain denominated-in-${currency.currency}`
	      }, formattedValue, " ", currency.currency);
	    } else {
	      return c("span", {
	        class: `amount pretty denominated-in-${currency.currency}`
	      }, currency.currency === 'XRP' ? c('[', null, c("i", {
	        class: "xrp"
	      })) : c('[', null, c("span", {
	        class: "currency"
	      }, "$")), c("span", {
	        class: "value"
	      }, formattedValue));
	    }
	  }
	};

	var Balances = (node => {
	  let account = node.ctx.account;
	  return {
	    oninit: node => node.ctx.requireBalances(),
	    view: node => c('[', null, account.balances ? c('[', null, c("ul", {
	      class: "currencies"
	    }, (() => {
	      let e = [];

	      for (let group of node.ctx.getGroupedBalances()) {
	        e.push(c('[', null, c(GroupedBalanceEntry, {
	          balances: group
	        })));
	      }
	      return e;
	    })())) : c('[', null, c("ul", {
	      class: "currencies"
	    }, (() => {
	      let e = [];

	      for (let i = 0; i < 3; i++) {
	        e.push(c('[', null, c(GroupedBalanceEntry.Skeleton, null)));
	      }
	      return e;
	    })())))
	  };
	});
	const GroupedBalanceEntry = {
	  view: node => {
	    let {
	      balances
	    } = node.attrs;
	    let balance = balances[0];
	    return c("li", null, c(Currency, {
	      currency: balance,
	      showIssuer: true
	    }), c(Amount, {
	      class: "balance",
	      plain: true,
	      currency: balance,
	      value: balance.value
	    }));
	  },
	  Skeleton: {
	    view: node => c("div", null)
	  }
	};

	const sections = [{
	  label: 'Balances',
	  href: '/wallet/balances',
	  key: 'balances'
	}, {
	  label: 'History',
	  href: '/wallet/history',
	  key: 'history'
	}];
	var Wallet = (node => {
	  let account = node.ctx.account;
	  return {
	    view: node => c("section", {
	      class: "wallet"
	    }, c("div", {
	      class: "account"
	    }, c("i", {
	      class: "user"
	    }), c("span", null, account.address.slice(0, 6))), c(Nav, {
	      items: sections,
	      active: node.attrs.section
	    }), node.attrs.section === 'balances' ? c('[', null, c(Balances, null)) : null)
	  };
	});

	var colorlib = {
		hexToRgb(hex) {
			let i = parseInt(hex.replace('#', ''), 16);
			let r = (i >> 16) & 255;
			let g = (i >> 8) & 255;
			let b = i & 255;

			return {r, g, b}
		},

		rgbToHsv({r, g, b}) {
			r /= 255;
			g /= 255;
			b /= 255;

			let max = Math.max(r, g, b);
			let min = Math.min(r, g, b);
			let h, s, v = max;

			let d = max - min;
			
			s = max == 0 ? 0 : d / max;

			if (max == min){
				h = 0;
			}else {
				switch (max) {
					case r: h = (g - b) / d + (g < b ? 6 : 0); break;
					case g: h = (b - r) / d + 2; break;
					case b: h = (r - g) / d + 4; break;
				}

				h /= 6;
			}

			return {h, s, v}
		},

		hsvToRgb({h, s, v}) {
			var r, g, b;

			var i = Math.floor(h * 6);
			var f = h * 6 - i;
			var p = v * (1 - s);
			var q = v * (1 - f * s);
			var t = v * (1 - (1 - f) * s);

			switch (i % 6) {
				case 0: r = v, g = t, b = p; break;
				case 1: r = q, g = v, b = p; break;
				case 2: r = p, g = v, b = t; break;
				case 3: r = p, g = q, b = v; break;
				case 4: r = t, g = p, b = v; break;
				case 5: r = v, g = p, b = q; break;
			}

			return {r: r * 255, g: g * 255, b: b * 255}
		}
	};

	function _assertThisInitialized(self) { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }

	function _inheritsLoose(subClass, superClass) { subClass.prototype = Object.create(superClass.prototype); subClass.prototype.constructor = subClass; subClass.__proto__ = superClass; }

	/*!
	 * GSAP 3.8.0
	 * https://greensock.com
	 *
	 * @license Copyright 2008-2021, GreenSock. All rights reserved.
	 * Subject to the terms at https://greensock.com/standard-license or for
	 * Club GreenSock members, the agreement issued with that membership.
	 * @author: Jack Doyle, jack@greensock.com
	*/

	/* eslint-disable */
	var _config = {
	  autoSleep: 120,
	  force3D: "auto",
	  nullTargetWarn: 1,
	  units: {
	    lineHeight: ""
	  }
	},
	    _defaults = {
	  duration: .5,
	  overwrite: false,
	  delay: 0
	},
	    _suppressOverwrites,
	    _bigNum$1 = 1e8,
	    _tinyNum = 1 / _bigNum$1,
	    _2PI = Math.PI * 2,
	    _HALF_PI = _2PI / 4,
	    _gsID = 0,
	    _sqrt = Math.sqrt,
	    _cos = Math.cos,
	    _sin = Math.sin,
	    _isString = function _isString(value) {
	  return typeof value === "string";
	},
	    _isFunction = function _isFunction(value) {
	  return typeof value === "function";
	},
	    _isNumber = function _isNumber(value) {
	  return typeof value === "number";
	},
	    _isUndefined = function _isUndefined(value) {
	  return typeof value === "undefined";
	},
	    _isObject = function _isObject(value) {
	  return typeof value === "object";
	},
	    _isNotFalse = function _isNotFalse(value) {
	  return value !== false;
	},
	    _windowExists$1 = function _windowExists() {
	  return typeof window !== "undefined";
	},
	    _isFuncOrString = function _isFuncOrString(value) {
	  return _isFunction(value) || _isString(value);
	},
	    _isTypedArray = typeof ArrayBuffer === "function" && ArrayBuffer.isView || function () {},
	    // note: IE10 has ArrayBuffer, but NOT ArrayBuffer.isView().
	_isArray = Array.isArray,
	    _strictNumExp = /(?:-?\.?\d|\.)+/gi,
	    //only numbers (including negatives and decimals) but NOT relative values.
	_numExp = /[-+=.]*\d+[.e\-+]*\d*[e\-+]*\d*/g,
	    //finds any numbers, including ones that start with += or -=, negative numbers, and ones in scientific notation like 1e-8.
	_numWithUnitExp = /[-+=.]*\d+[.e-]*\d*[a-z%]*/g,
	    _complexStringNumExp = /[-+=.]*\d+\.?\d*(?:e-|e\+)?\d*/gi,
	    //duplicate so that while we're looping through matches from exec(), it doesn't contaminate the lastIndex of _numExp which we use to search for colors too.
	_relExp = /[+-]=-?[.\d]+/,
	    _delimitedValueExp = /[^,'"\[\]\s]+/gi,
	    // previously /[#\-+.]*\b[a-z\d\-=+%.]+/gi but didn't catch special characters.
	_unitExp = /[\d.+\-=]+(?:e[-+]\d*)*/i,
	    _globalTimeline,
	    _win$1,
	    _coreInitted,
	    _doc$1,
	    _globals = {},
	    _installScope = {},
	    _coreReady,
	    _install = function _install(scope) {
	  return (_installScope = _merge(scope, _globals)) && gsap;
	},
	    _missingPlugin = function _missingPlugin(property, value) {
	  return console.warn("Invalid property", property, "set to", value, "Missing plugin? gsap.registerPlugin()");
	},
	    _warn = function _warn(message, suppress) {
	  return !suppress && console.warn(message);
	},
	    _addGlobal = function _addGlobal(name, obj) {
	  return name && (_globals[name] = obj) && _installScope && (_installScope[name] = obj) || _globals;
	},
	    _emptyFunc = function _emptyFunc() {
	  return 0;
	},
	    _reservedProps = {},
	    _lazyTweens = [],
	    _lazyLookup = {},
	    _lastRenderedFrame,
	    _plugins = {},
	    _effects = {},
	    _nextGCFrame = 30,
	    _harnessPlugins = [],
	    _callbackNames = "",
	    _harness = function _harness(targets) {
	  var target = targets[0],
	      harnessPlugin,
	      i;
	  _isObject(target) || _isFunction(target) || (targets = [targets]);

	  if (!(harnessPlugin = (target._gsap || {}).harness)) {
	    // find the first target with a harness. We assume targets passed into an animation will be of similar type, meaning the same kind of harness can be used for them all (performance optimization)
	    i = _harnessPlugins.length;

	    while (i-- && !_harnessPlugins[i].targetTest(target)) {}

	    harnessPlugin = _harnessPlugins[i];
	  }

	  i = targets.length;

	  while (i--) {
	    targets[i] && (targets[i]._gsap || (targets[i]._gsap = new GSCache(targets[i], harnessPlugin))) || targets.splice(i, 1);
	  }

	  return targets;
	},
	    _getCache = function _getCache(target) {
	  return target._gsap || _harness(toArray(target))[0]._gsap;
	},
	    _getProperty = function _getProperty(target, property, v) {
	  return (v = target[property]) && _isFunction(v) ? target[property]() : _isUndefined(v) && target.getAttribute && target.getAttribute(property) || v;
	},
	    _forEachName = function _forEachName(names, func) {
	  return (names = names.split(",")).forEach(func) || names;
	},
	    //split a comma-delimited list of names into an array, then run a forEach() function and return the split array (this is just a way to consolidate/shorten some code).
	_round = function _round(value) {
	  return Math.round(value * 100000) / 100000 || 0;
	},
	    _roundPrecise = function _roundPrecise(value) {
	  return Math.round(value * 10000000) / 10000000 || 0;
	},
	    // increased precision mostly for timing values.
	_arrayContainsAny = function _arrayContainsAny(toSearch, toFind) {
	  //searches one array to find matches for any of the items in the toFind array. As soon as one is found, it returns true. It does NOT return all the matches; it's simply a boolean search.
	  var l = toFind.length,
	      i = 0;

	  for (; toSearch.indexOf(toFind[i]) < 0 && ++i < l;) {}

	  return i < l;
	},
	    _lazyRender = function _lazyRender() {
	  var l = _lazyTweens.length,
	      a = _lazyTweens.slice(0),
	      i,
	      tween;

	  _lazyLookup = {};
	  _lazyTweens.length = 0;

	  for (i = 0; i < l; i++) {
	    tween = a[i];
	    tween && tween._lazy && (tween.render(tween._lazy[0], tween._lazy[1], true)._lazy = 0);
	  }
	},
	    _lazySafeRender = function _lazySafeRender(animation, time, suppressEvents, force) {
	  _lazyTweens.length && _lazyRender();
	  animation.render(time, suppressEvents, force);
	  _lazyTweens.length && _lazyRender(); //in case rendering caused any tweens to lazy-init, we should render them because typically when someone calls seek() or time() or progress(), they expect an immediate render.
	},
	    _numericIfPossible = function _numericIfPossible(value) {
	  var n = parseFloat(value);
	  return (n || n === 0) && (value + "").match(_delimitedValueExp).length < 2 ? n : _isString(value) ? value.trim() : value;
	},
	    _passThrough = function _passThrough(p) {
	  return p;
	},
	    _setDefaults = function _setDefaults(obj, defaults) {
	  for (var p in defaults) {
	    p in obj || (obj[p] = defaults[p]);
	  }

	  return obj;
	},
	    _setKeyframeDefaults = function _setKeyframeDefaults(obj, defaults) {
	  for (var p in defaults) {
	    p in obj || p === "duration" || p === "ease" || (obj[p] = defaults[p]);
	  }
	},
	    _merge = function _merge(base, toMerge) {
	  for (var p in toMerge) {
	    base[p] = toMerge[p];
	  }

	  return base;
	},
	    _mergeDeep = function _mergeDeep(base, toMerge) {
	  for (var p in toMerge) {
	    p !== "__proto__" && p !== "constructor" && p !== "prototype" && (base[p] = _isObject(toMerge[p]) ? _mergeDeep(base[p] || (base[p] = {}), toMerge[p]) : toMerge[p]);
	  }

	  return base;
	},
	    _copyExcluding = function _copyExcluding(obj, excluding) {
	  var copy = {},
	      p;

	  for (p in obj) {
	    p in excluding || (copy[p] = obj[p]);
	  }

	  return copy;
	},
	    _inheritDefaults = function _inheritDefaults(vars) {
	  var parent = vars.parent || _globalTimeline,
	      func = vars.keyframes ? _setKeyframeDefaults : _setDefaults;

	  if (_isNotFalse(vars.inherit)) {
	    while (parent) {
	      func(vars, parent.vars.defaults);
	      parent = parent.parent || parent._dp;
	    }
	  }

	  return vars;
	},
	    _arraysMatch = function _arraysMatch(a1, a2) {
	  var i = a1.length,
	      match = i === a2.length;

	  while (match && i-- && a1[i] === a2[i]) {}

	  return i < 0;
	},
	    _addLinkedListItem = function _addLinkedListItem(parent, child, firstProp, lastProp, sortBy) {
	  if (firstProp === void 0) {
	    firstProp = "_first";
	  }

	  if (lastProp === void 0) {
	    lastProp = "_last";
	  }

	  var prev = parent[lastProp],
	      t;

	  if (sortBy) {
	    t = child[sortBy];

	    while (prev && prev[sortBy] > t) {
	      prev = prev._prev;
	    }
	  }

	  if (prev) {
	    child._next = prev._next;
	    prev._next = child;
	  } else {
	    child._next = parent[firstProp];
	    parent[firstProp] = child;
	  }

	  if (child._next) {
	    child._next._prev = child;
	  } else {
	    parent[lastProp] = child;
	  }

	  child._prev = prev;
	  child.parent = child._dp = parent;
	  return child;
	},
	    _removeLinkedListItem = function _removeLinkedListItem(parent, child, firstProp, lastProp) {
	  if (firstProp === void 0) {
	    firstProp = "_first";
	  }

	  if (lastProp === void 0) {
	    lastProp = "_last";
	  }

	  var prev = child._prev,
	      next = child._next;

	  if (prev) {
	    prev._next = next;
	  } else if (parent[firstProp] === child) {
	    parent[firstProp] = next;
	  }

	  if (next) {
	    next._prev = prev;
	  } else if (parent[lastProp] === child) {
	    parent[lastProp] = prev;
	  }

	  child._next = child._prev = child.parent = null; // don't delete the _dp just so we can revert if necessary. But parent should be null to indicate the item isn't in a linked list.
	},
	    _removeFromParent = function _removeFromParent(child, onlyIfParentHasAutoRemove) {
	  child.parent && (!onlyIfParentHasAutoRemove || child.parent.autoRemoveChildren) && child.parent.remove(child);
	  child._act = 0;
	},
	    _uncache = function _uncache(animation, child) {
	  if (animation && (!child || child._end > animation._dur || child._start < 0)) {
	    // performance optimization: if a child animation is passed in we should only uncache if that child EXTENDS the animation (its end time is beyond the end)
	    var a = animation;

	    while (a) {
	      a._dirty = 1;
	      a = a.parent;
	    }
	  }

	  return animation;
	},
	    _recacheAncestors = function _recacheAncestors(animation) {
	  var parent = animation.parent;

	  while (parent && parent.parent) {
	    //sometimes we must force a re-sort of all children and update the duration/totalDuration of all ancestor timelines immediately in case, for example, in the middle of a render loop, one tween alters another tween's timeScale which shoves its startTime before 0, forcing the parent timeline to shift around and shiftChildren() which could affect that next tween's render (startTime). Doesn't matter for the root timeline though.
	    parent._dirty = 1;
	    parent.totalDuration();
	    parent = parent.parent;
	  }

	  return animation;
	},
	    _hasNoPausedAncestors = function _hasNoPausedAncestors(animation) {
	  return !animation || animation._ts && _hasNoPausedAncestors(animation.parent);
	},
	    _elapsedCycleDuration = function _elapsedCycleDuration(animation) {
	  return animation._repeat ? _animationCycle(animation._tTime, animation = animation.duration() + animation._rDelay) * animation : 0;
	},
	    // feed in the totalTime and cycleDuration and it'll return the cycle (iteration minus 1) and if the playhead is exactly at the very END, it will NOT bump up to the next cycle.
	_animationCycle = function _animationCycle(tTime, cycleDuration) {
	  var whole = Math.floor(tTime /= cycleDuration);
	  return tTime && whole === tTime ? whole - 1 : whole;
	},
	    _parentToChildTotalTime = function _parentToChildTotalTime(parentTime, child) {
	  return (parentTime - child._start) * child._ts + (child._ts >= 0 ? 0 : child._dirty ? child.totalDuration() : child._tDur);
	},
	    _setEnd = function _setEnd(animation) {
	  return animation._end = _roundPrecise(animation._start + (animation._tDur / Math.abs(animation._ts || animation._rts || _tinyNum) || 0));
	},
	    _alignPlayhead = function _alignPlayhead(animation, totalTime) {
	  // adjusts the animation's _start and _end according to the provided totalTime (only if the parent's smoothChildTiming is true and the animation isn't paused). It doesn't do any rendering or forcing things back into parent timelines, etc. - that's what totalTime() is for.
	  var parent = animation._dp;

	  if (parent && parent.smoothChildTiming && animation._ts) {
	    animation._start = _roundPrecise(parent._time - (animation._ts > 0 ? totalTime / animation._ts : ((animation._dirty ? animation.totalDuration() : animation._tDur) - totalTime) / -animation._ts));

	    _setEnd(animation);

	    parent._dirty || _uncache(parent, animation); //for performance improvement. If the parent's cache is already dirty, it already took care of marking the ancestors as dirty too, so skip the function call here.
	  }

	  return animation;
	},

	/*
	_totalTimeToTime = (clampedTotalTime, duration, repeat, repeatDelay, yoyo) => {
		let cycleDuration = duration + repeatDelay,
			time = _round(clampedTotalTime % cycleDuration);
		if (time > duration) {
			time = duration;
		}
		return (yoyo && (~~(clampedTotalTime / cycleDuration) & 1)) ? duration - time : time;
	},
	*/
	_postAddChecks = function _postAddChecks(timeline, child) {
	  var t;

	  if (child._time || child._initted && !child._dur) {
	    //in case, for example, the _start is moved on a tween that has already rendered. Imagine it's at its end state, then the startTime is moved WAY later (after the end of this timeline), it should render at its beginning.
	    t = _parentToChildTotalTime(timeline.rawTime(), child);

	    if (!child._dur || _clamp(0, child.totalDuration(), t) - child._tTime > _tinyNum) {
	      child.render(t, true);
	    }
	  } //if the timeline has already ended but the inserted tween/timeline extends the duration, we should enable this timeline again so that it renders properly. We should also align the playhead with the parent timeline's when appropriate.


	  if (_uncache(timeline, child)._dp && timeline._initted && timeline._time >= timeline._dur && timeline._ts) {
	    //in case any of the ancestors had completed but should now be enabled...
	    if (timeline._dur < timeline.duration()) {
	      t = timeline;

	      while (t._dp) {
	        t.rawTime() >= 0 && t.totalTime(t._tTime); //moves the timeline (shifts its startTime) if necessary, and also enables it. If it's currently zero, though, it may not be scheduled to render until later so there's no need to force it to align with the current playhead position. Only move to catch up with the playhead.

	        t = t._dp;
	      }
	    }

	    timeline._zTime = -_tinyNum; // helps ensure that the next render() will be forced (crossingStart = true in render()), even if the duration hasn't changed (we're adding a child which would need to get rendered). Definitely an edge case. Note: we MUST do this AFTER the loop above where the totalTime() might trigger a render() because this _addToTimeline() method gets called from the Animation constructor, BEFORE tweens even record their targets, etc. so we wouldn't want things to get triggered in the wrong order.
	  }
	},
	    _addToTimeline = function _addToTimeline(timeline, child, position, skipChecks) {
	  child.parent && _removeFromParent(child);
	  child._start = _roundPrecise((_isNumber(position) ? position : position || timeline !== _globalTimeline ? _parsePosition(timeline, position, child) : timeline._time) + child._delay);
	  child._end = _roundPrecise(child._start + (child.totalDuration() / Math.abs(child.timeScale()) || 0));

	  _addLinkedListItem(timeline, child, "_first", "_last", timeline._sort ? "_start" : 0);

	  _isFromOrFromStart(child) || (timeline._recent = child);
	  skipChecks || _postAddChecks(timeline, child);
	  return timeline;
	},
	    _scrollTrigger = function _scrollTrigger(animation, trigger) {
	  return (_globals.ScrollTrigger || _missingPlugin("scrollTrigger", trigger)) && _globals.ScrollTrigger.create(trigger, animation);
	},
	    _attemptInitTween = function _attemptInitTween(tween, totalTime, force, suppressEvents) {
	  _initTween(tween, totalTime);

	  if (!tween._initted) {
	    return 1;
	  }

	  if (!force && tween._pt && (tween._dur && tween.vars.lazy !== false || !tween._dur && tween.vars.lazy) && _lastRenderedFrame !== _ticker.frame) {
	    _lazyTweens.push(tween);

	    tween._lazy = [totalTime, suppressEvents];
	    return 1;
	  }
	},
	    _parentPlayheadIsBeforeStart = function _parentPlayheadIsBeforeStart(_ref) {
	  var parent = _ref.parent;
	  return parent && parent._ts && parent._initted && !parent._lock && (parent.rawTime() < 0 || _parentPlayheadIsBeforeStart(parent));
	},
	    // check parent's _lock because when a timeline repeats/yoyos and does its artificial wrapping, we shouldn't force the ratio back to 0
	_isFromOrFromStart = function _isFromOrFromStart(_ref2) {
	  var data = _ref2.data;
	  return data === "isFromStart" || data === "isStart";
	},
	    _renderZeroDurationTween = function _renderZeroDurationTween(tween, totalTime, suppressEvents, force) {
	  var prevRatio = tween.ratio,
	      ratio = totalTime < 0 || !totalTime && (!tween._start && _parentPlayheadIsBeforeStart(tween) && !(!tween._initted && _isFromOrFromStart(tween)) || (tween._ts < 0 || tween._dp._ts < 0) && !_isFromOrFromStart(tween)) ? 0 : 1,
	      // if the tween or its parent is reversed and the totalTime is 0, we should go to a ratio of 0. Edge case: if a from() or fromTo() stagger tween is placed later in a timeline, the "startAt" zero-duration tween could initially render at a time when the parent timeline's playhead is technically BEFORE where this tween is, so make sure that any "from" and "fromTo" startAt tweens are rendered the first time at a ratio of 1.
	  repeatDelay = tween._rDelay,
	      tTime = 0,
	      pt,
	      iteration,
	      prevIteration;

	  if (repeatDelay && tween._repeat) {
	    // in case there's a zero-duration tween that has a repeat with a repeatDelay
	    tTime = _clamp(0, tween._tDur, totalTime);
	    iteration = _animationCycle(tTime, repeatDelay);
	    prevIteration = _animationCycle(tween._tTime, repeatDelay);
	    tween._yoyo && iteration & 1 && (ratio = 1 - ratio);

	    if (iteration !== prevIteration) {
	      prevRatio = 1 - ratio;
	      tween.vars.repeatRefresh && tween._initted && tween.invalidate();
	    }
	  }

	  if (ratio !== prevRatio || force || tween._zTime === _tinyNum || !totalTime && tween._zTime) {
	    if (!tween._initted && _attemptInitTween(tween, totalTime, force, suppressEvents)) {
	      // if we render the very beginning (time == 0) of a fromTo(), we must force the render (normal tweens wouldn't need to render at a time of 0 when the prevTime was also 0). This is also mandatory to make sure overwriting kicks in immediately.
	      return;
	    }

	    prevIteration = tween._zTime;
	    tween._zTime = totalTime || (suppressEvents ? _tinyNum : 0); // when the playhead arrives at EXACTLY time 0 (right on top) of a zero-duration tween, we need to discern if events are suppressed so that when the playhead moves again (next time), it'll trigger the callback. If events are NOT suppressed, obviously the callback would be triggered in this render. Basically, the callback should fire either when the playhead ARRIVES or LEAVES this exact spot, not both. Imagine doing a timeline.seek(0) and there's a callback that sits at 0. Since events are suppressed on that seek() by default, nothing will fire, but when the playhead moves off of that position, the callback should fire. This behavior is what people intuitively expect.

	    suppressEvents || (suppressEvents = totalTime && !prevIteration); // if it was rendered previously at exactly 0 (_zTime) and now the playhead is moving away, DON'T fire callbacks otherwise they'll seem like duplicates.

	    tween.ratio = ratio;
	    tween._from && (ratio = 1 - ratio);
	    tween._time = 0;
	    tween._tTime = tTime;
	    pt = tween._pt;

	    while (pt) {
	      pt.r(ratio, pt.d);
	      pt = pt._next;
	    }

	    tween._startAt && totalTime < 0 && tween._startAt.render(totalTime, true, true);
	    tween._onUpdate && !suppressEvents && _callback(tween, "onUpdate");
	    tTime && tween._repeat && !suppressEvents && tween.parent && _callback(tween, "onRepeat");

	    if ((totalTime >= tween._tDur || totalTime < 0) && tween.ratio === ratio) {
	      ratio && _removeFromParent(tween, 1);

	      if (!suppressEvents) {
	        _callback(tween, ratio ? "onComplete" : "onReverseComplete", true);

	        tween._prom && tween._prom();
	      }
	    }
	  } else if (!tween._zTime) {
	    tween._zTime = totalTime;
	  }
	},
	    _findNextPauseTween = function _findNextPauseTween(animation, prevTime, time) {
	  var child;

	  if (time > prevTime) {
	    child = animation._first;

	    while (child && child._start <= time) {
	      if (!child._dur && child.data === "isPause" && child._start > prevTime) {
	        return child;
	      }

	      child = child._next;
	    }
	  } else {
	    child = animation._last;

	    while (child && child._start >= time) {
	      if (!child._dur && child.data === "isPause" && child._start < prevTime) {
	        return child;
	      }

	      child = child._prev;
	    }
	  }
	},
	    _setDuration = function _setDuration(animation, duration, skipUncache, leavePlayhead) {
	  var repeat = animation._repeat,
	      dur = _roundPrecise(duration) || 0,
	      totalProgress = animation._tTime / animation._tDur;
	  totalProgress && !leavePlayhead && (animation._time *= dur / animation._dur);
	  animation._dur = dur;
	  animation._tDur = !repeat ? dur : repeat < 0 ? 1e10 : _roundPrecise(dur * (repeat + 1) + animation._rDelay * repeat);
	  totalProgress && !leavePlayhead ? _alignPlayhead(animation, animation._tTime = animation._tDur * totalProgress) : animation.parent && _setEnd(animation);
	  skipUncache || _uncache(animation.parent, animation);
	  return animation;
	},
	    _onUpdateTotalDuration = function _onUpdateTotalDuration(animation) {
	  return animation instanceof Timeline ? _uncache(animation) : _setDuration(animation, animation._dur);
	},
	    _zeroPosition = {
	  _start: 0,
	  endTime: _emptyFunc,
	  totalDuration: _emptyFunc
	},
	    _parsePosition = function _parsePosition(animation, position, percentAnimation) {
	  var labels = animation.labels,
	      recent = animation._recent || _zeroPosition,
	      clippedDuration = animation.duration() >= _bigNum$1 ? recent.endTime(false) : animation._dur,
	      //in case there's a child that infinitely repeats, users almost never intend for the insertion point of a new child to be based on a SUPER long value like that so we clip it and assume the most recently-added child's endTime should be used instead.
	  i,
	      offset,
	      isPercent;

	  if (_isString(position) && (isNaN(position) || position in labels)) {
	    //if the string is a number like "1", check to see if there's a label with that name, otherwise interpret it as a number (absolute value).
	    offset = position.charAt(0);
	    isPercent = position.substr(-1) === "%";
	    i = position.indexOf("=");

	    if (offset === "<" || offset === ">") {
	      i >= 0 && (position = position.replace(/=/, ""));
	      return (offset === "<" ? recent._start : recent.endTime(recent._repeat >= 0)) + (parseFloat(position.substr(1)) || 0) * (isPercent ? (i < 0 ? recent : percentAnimation).totalDuration() / 100 : 1);
	    }

	    if (i < 0) {
	      position in labels || (labels[position] = clippedDuration);
	      return labels[position];
	    }

	    offset = parseFloat(position.charAt(i - 1) + position.substr(i + 1));

	    if (isPercent && percentAnimation) {
	      offset = offset / 100 * (_isArray(percentAnimation) ? percentAnimation[0] : percentAnimation).totalDuration();
	    }

	    return i > 1 ? _parsePosition(animation, position.substr(0, i - 1), percentAnimation) + offset : clippedDuration + offset;
	  }

	  return position == null ? clippedDuration : +position;
	},
	    _createTweenType = function _createTweenType(type, params, timeline) {
	  var isLegacy = _isNumber(params[1]),
	      varsIndex = (isLegacy ? 2 : 1) + (type < 2 ? 0 : 1),
	      vars = params[varsIndex],
	      irVars,
	      parent;

	  isLegacy && (vars.duration = params[1]);
	  vars.parent = timeline;

	  if (type) {
	    irVars = vars;
	    parent = timeline;

	    while (parent && !("immediateRender" in irVars)) {
	      // inheritance hasn't happened yet, but someone may have set a default in an ancestor timeline. We could do vars.immediateRender = _isNotFalse(_inheritDefaults(vars).immediateRender) but that'd exact a slight performance penalty because _inheritDefaults() also runs in the Tween constructor. We're paying a small kb price here to gain speed.
	      irVars = parent.vars.defaults || {};
	      parent = _isNotFalse(parent.vars.inherit) && parent.parent;
	    }

	    vars.immediateRender = _isNotFalse(irVars.immediateRender);
	    type < 2 ? vars.runBackwards = 1 : vars.startAt = params[varsIndex - 1]; // "from" vars
	  }

	  return new Tween(params[0], vars, params[varsIndex + 1]);
	},
	    _conditionalReturn = function _conditionalReturn(value, func) {
	  return value || value === 0 ? func(value) : func;
	},
	    _clamp = function _clamp(min, max, value) {
	  return value < min ? min : value > max ? max : value;
	},
	    getUnit = function getUnit(value) {
	  if (typeof value !== "string") {
	    return "";
	  }

	  var v = _unitExp.exec(value);

	  return v ? value.substr(v.index + v[0].length) : "";
	},
	    // note: protect against padded numbers as strings, like "100.100". That shouldn't return "00" as the unit. If it's numeric, return no unit.
	clamp = function clamp(min, max, value) {
	  return _conditionalReturn(value, function (v) {
	    return _clamp(min, max, v);
	  });
	},
	    _slice = [].slice,
	    _isArrayLike = function _isArrayLike(value, nonEmpty) {
	  return value && _isObject(value) && "length" in value && (!nonEmpty && !value.length || value.length - 1 in value && _isObject(value[0])) && !value.nodeType && value !== _win$1;
	},
	    _flatten = function _flatten(ar, leaveStrings, accumulator) {
	  if (accumulator === void 0) {
	    accumulator = [];
	  }

	  return ar.forEach(function (value) {
	    var _accumulator;

	    return _isString(value) && !leaveStrings || _isArrayLike(value, 1) ? (_accumulator = accumulator).push.apply(_accumulator, toArray(value)) : accumulator.push(value);
	  }) || accumulator;
	},
	    //takes any value and returns an array. If it's a string (and leaveStrings isn't true), it'll use document.querySelectorAll() and convert that to an array. It'll also accept iterables like jQuery objects.
	toArray = function toArray(value, scope, leaveStrings) {
	  return _isString(value) && !leaveStrings && (_coreInitted || !_wake()) ? _slice.call((scope || _doc$1).querySelectorAll(value), 0) : _isArray(value) ? _flatten(value, leaveStrings) : _isArrayLike(value) ? _slice.call(value, 0) : value ? [value] : [];
	},
	    selector = function selector(value) {
	  value = toArray(value)[0] || _warn("Invalid scope") || {};
	  return function (v) {
	    var el = value.current || value.nativeElement || value;
	    return toArray(v, el.querySelectorAll ? el : el === value ? _warn("Invalid scope") || _doc$1.createElement("div") : value);
	  };
	},
	    shuffle = function shuffle(a) {
	  return a.sort(function () {
	    return .5 - Math.random();
	  });
	},
	    // alternative that's a bit faster and more reliably diverse but bigger:   for (let j, v, i = a.length; i; j = Math.floor(Math.random() * i), v = a[--i], a[i] = a[j], a[j] = v); return a;
	//for distributing values across an array. Can accept a number, a function or (most commonly) a function which can contain the following properties: {base, amount, from, ease, grid, axis, length, each}. Returns a function that expects the following parameters: index, target, array. Recognizes the following
	distribute = function distribute(v) {
	  if (_isFunction(v)) {
	    return v;
	  }

	  var vars = _isObject(v) ? v : {
	    each: v
	  },
	      //n:1 is just to indicate v was a number; we leverage that later to set v according to the length we get. If a number is passed in, we treat it like the old stagger value where 0.1, for example, would mean that things would be distributed with 0.1 between each element in the array rather than a total "amount" that's chunked out among them all.
	  ease = _parseEase(vars.ease),
	      from = vars.from || 0,
	      base = parseFloat(vars.base) || 0,
	      cache = {},
	      isDecimal = from > 0 && from < 1,
	      ratios = isNaN(from) || isDecimal,
	      axis = vars.axis,
	      ratioX = from,
	      ratioY = from;

	  if (_isString(from)) {
	    ratioX = ratioY = {
	      center: .5,
	      edges: .5,
	      end: 1
	    }[from] || 0;
	  } else if (!isDecimal && ratios) {
	    ratioX = from[0];
	    ratioY = from[1];
	  }

	  return function (i, target, a) {
	    var l = (a || vars).length,
	        distances = cache[l],
	        originX,
	        originY,
	        x,
	        y,
	        d,
	        j,
	        max,
	        min,
	        wrapAt;

	    if (!distances) {
	      wrapAt = vars.grid === "auto" ? 0 : (vars.grid || [1, _bigNum$1])[1];

	      if (!wrapAt) {
	        max = -_bigNum$1;

	        while (max < (max = a[wrapAt++].getBoundingClientRect().left) && wrapAt < l) {}

	        wrapAt--;
	      }

	      distances = cache[l] = [];
	      originX = ratios ? Math.min(wrapAt, l) * ratioX - .5 : from % wrapAt;
	      originY = ratios ? l * ratioY / wrapAt - .5 : from / wrapAt | 0;
	      max = 0;
	      min = _bigNum$1;

	      for (j = 0; j < l; j++) {
	        x = j % wrapAt - originX;
	        y = originY - (j / wrapAt | 0);
	        distances[j] = d = !axis ? _sqrt(x * x + y * y) : Math.abs(axis === "y" ? y : x);
	        d > max && (max = d);
	        d < min && (min = d);
	      }

	      from === "random" && shuffle(distances);
	      distances.max = max - min;
	      distances.min = min;
	      distances.v = l = (parseFloat(vars.amount) || parseFloat(vars.each) * (wrapAt > l ? l - 1 : !axis ? Math.max(wrapAt, l / wrapAt) : axis === "y" ? l / wrapAt : wrapAt) || 0) * (from === "edges" ? -1 : 1);
	      distances.b = l < 0 ? base - l : base;
	      distances.u = getUnit(vars.amount || vars.each) || 0; //unit

	      ease = ease && l < 0 ? _invertEase(ease) : ease;
	    }

	    l = (distances[i] - distances.min) / distances.max || 0;
	    return _roundPrecise(distances.b + (ease ? ease(l) : l) * distances.v) + distances.u; //round in order to work around floating point errors
	  };
	},
	    _roundModifier = function _roundModifier(v) {
	  //pass in 0.1 get a function that'll round to the nearest tenth, or 5 to round to the closest 5, or 0.001 to the closest 1000th, etc.
	  var p = Math.pow(10, ((v + "").split(".")[1] || "").length); //to avoid floating point math errors (like 24 * 0.1 == 2.4000000000000004), we chop off at a specific number of decimal places (much faster than toFixed())

	  return function (raw) {
	    var n = Math.round(parseFloat(raw) / v) * v * p;
	    return (n - n % 1) / p + (_isNumber(raw) ? 0 : getUnit(raw)); // n - n % 1 replaces Math.floor() in order to handle negative values properly. For example, Math.floor(-150.00000000000003) is 151!
	  };
	},
	    snap = function snap(snapTo, value) {
	  var isArray = _isArray(snapTo),
	      radius,
	      is2D;

	  if (!isArray && _isObject(snapTo)) {
	    radius = isArray = snapTo.radius || _bigNum$1;

	    if (snapTo.values) {
	      snapTo = toArray(snapTo.values);

	      if (is2D = !_isNumber(snapTo[0])) {
	        radius *= radius; //performance optimization so we don't have to Math.sqrt() in the loop.
	      }
	    } else {
	      snapTo = _roundModifier(snapTo.increment);
	    }
	  }

	  return _conditionalReturn(value, !isArray ? _roundModifier(snapTo) : _isFunction(snapTo) ? function (raw) {
	    is2D = snapTo(raw);
	    return Math.abs(is2D - raw) <= radius ? is2D : raw;
	  } : function (raw) {
	    var x = parseFloat(is2D ? raw.x : raw),
	        y = parseFloat(is2D ? raw.y : 0),
	        min = _bigNum$1,
	        closest = 0,
	        i = snapTo.length,
	        dx,
	        dy;

	    while (i--) {
	      if (is2D) {
	        dx = snapTo[i].x - x;
	        dy = snapTo[i].y - y;
	        dx = dx * dx + dy * dy;
	      } else {
	        dx = Math.abs(snapTo[i] - x);
	      }

	      if (dx < min) {
	        min = dx;
	        closest = i;
	      }
	    }

	    closest = !radius || min <= radius ? snapTo[closest] : raw;
	    return is2D || closest === raw || _isNumber(raw) ? closest : closest + getUnit(raw);
	  });
	},
	    random = function random(min, max, roundingIncrement, returnFunction) {
	  return _conditionalReturn(_isArray(min) ? !max : roundingIncrement === true ? !!(roundingIncrement = 0) : !returnFunction, function () {
	    return _isArray(min) ? min[~~(Math.random() * min.length)] : (roundingIncrement = roundingIncrement || 1e-5) && (returnFunction = roundingIncrement < 1 ? Math.pow(10, (roundingIncrement + "").length - 2) : 1) && Math.floor(Math.round((min - roundingIncrement / 2 + Math.random() * (max - min + roundingIncrement * .99)) / roundingIncrement) * roundingIncrement * returnFunction) / returnFunction;
	  });
	},
	    pipe = function pipe() {
	  for (var _len = arguments.length, functions = new Array(_len), _key = 0; _key < _len; _key++) {
	    functions[_key] = arguments[_key];
	  }

	  return function (value) {
	    return functions.reduce(function (v, f) {
	      return f(v);
	    }, value);
	  };
	},
	    unitize = function unitize(func, unit) {
	  return function (value) {
	    return func(parseFloat(value)) + (unit || getUnit(value));
	  };
	},
	    normalize = function normalize(min, max, value) {
	  return mapRange(min, max, 0, 1, value);
	},
	    _wrapArray = function _wrapArray(a, wrapper, value) {
	  return _conditionalReturn(value, function (index) {
	    return a[~~wrapper(index)];
	  });
	},
	    wrap = function wrap(min, max, value) {
	  // NOTE: wrap() CANNOT be an arrow function! A very odd compiling bug causes problems (unrelated to GSAP).
	  var range = max - min;
	  return _isArray(min) ? _wrapArray(min, wrap(0, min.length), max) : _conditionalReturn(value, function (value) {
	    return (range + (value - min) % range) % range + min;
	  });
	},
	    wrapYoyo = function wrapYoyo(min, max, value) {
	  var range = max - min,
	      total = range * 2;
	  return _isArray(min) ? _wrapArray(min, wrapYoyo(0, min.length - 1), max) : _conditionalReturn(value, function (value) {
	    value = (total + (value - min) % total) % total || 0;
	    return min + (value > range ? total - value : value);
	  });
	},
	    _replaceRandom = function _replaceRandom(value) {
	  //replaces all occurrences of random(...) in a string with the calculated random value. can be a range like random(-100, 100, 5) or an array like random([0, 100, 500])
	  var prev = 0,
	      s = "",
	      i,
	      nums,
	      end,
	      isArray;

	  while (~(i = value.indexOf("random(", prev))) {
	    end = value.indexOf(")", i);
	    isArray = value.charAt(i + 7) === "[";
	    nums = value.substr(i + 7, end - i - 7).match(isArray ? _delimitedValueExp : _strictNumExp);
	    s += value.substr(prev, i - prev) + random(isArray ? nums : +nums[0], isArray ? 0 : +nums[1], +nums[2] || 1e-5);
	    prev = end + 1;
	  }

	  return s + value.substr(prev, value.length - prev);
	},
	    mapRange = function mapRange(inMin, inMax, outMin, outMax, value) {
	  var inRange = inMax - inMin,
	      outRange = outMax - outMin;
	  return _conditionalReturn(value, function (value) {
	    return outMin + ((value - inMin) / inRange * outRange || 0);
	  });
	},
	    interpolate = function interpolate(start, end, progress, mutate) {
	  var func = isNaN(start + end) ? 0 : function (p) {
	    return (1 - p) * start + p * end;
	  };

	  if (!func) {
	    var isString = _isString(start),
	        master = {},
	        p,
	        i,
	        interpolators,
	        l,
	        il;

	    progress === true && (mutate = 1) && (progress = null);

	    if (isString) {
	      start = {
	        p: start
	      };
	      end = {
	        p: end
	      };
	    } else if (_isArray(start) && !_isArray(end)) {
	      interpolators = [];
	      l = start.length;
	      il = l - 2;

	      for (i = 1; i < l; i++) {
	        interpolators.push(interpolate(start[i - 1], start[i])); //build the interpolators up front as a performance optimization so that when the function is called many times, it can just reuse them.
	      }

	      l--;

	      func = function func(p) {
	        p *= l;
	        var i = Math.min(il, ~~p);
	        return interpolators[i](p - i);
	      };

	      progress = end;
	    } else if (!mutate) {
	      start = _merge(_isArray(start) ? [] : {}, start);
	    }

	    if (!interpolators) {
	      for (p in end) {
	        _addPropTween.call(master, start, p, "get", end[p]);
	      }

	      func = function func(p) {
	        return _renderPropTweens(p, master) || (isString ? start.p : start);
	      };
	    }
	  }

	  return _conditionalReturn(progress, func);
	},
	    _getLabelInDirection = function _getLabelInDirection(timeline, fromTime, backward) {
	  //used for nextLabel() and previousLabel()
	  var labels = timeline.labels,
	      min = _bigNum$1,
	      p,
	      distance,
	      label;

	  for (p in labels) {
	    distance = labels[p] - fromTime;

	    if (distance < 0 === !!backward && distance && min > (distance = Math.abs(distance))) {
	      label = p;
	      min = distance;
	    }
	  }

	  return label;
	},
	    _callback = function _callback(animation, type, executeLazyFirst) {
	  var v = animation.vars,
	      callback = v[type],
	      params,
	      scope;

	  if (!callback) {
	    return;
	  }

	  params = v[type + "Params"];
	  scope = v.callbackScope || animation;
	  executeLazyFirst && _lazyTweens.length && _lazyRender(); //in case rendering caused any tweens to lazy-init, we should render them because typically when a timeline finishes, users expect things to have rendered fully. Imagine an onUpdate on a timeline that reports/checks tweened values.

	  return params ? callback.apply(scope, params) : callback.call(scope);
	},
	    _interrupt = function _interrupt(animation) {
	  _removeFromParent(animation);

	  animation.scrollTrigger && animation.scrollTrigger.kill(false);
	  animation.progress() < 1 && _callback(animation, "onInterrupt");
	  return animation;
	},
	    _quickTween,
	    _createPlugin = function _createPlugin(config) {
	  config = !config.name && config["default"] || config; //UMD packaging wraps things oddly, so for example MotionPathHelper becomes {MotionPathHelper:MotionPathHelper, default:MotionPathHelper}.

	  var name = config.name,
	      isFunc = _isFunction(config),
	      Plugin = name && !isFunc && config.init ? function () {
	    this._props = [];
	  } : config,
	      //in case someone passes in an object that's not a plugin, like CustomEase
	  instanceDefaults = {
	    init: _emptyFunc,
	    render: _renderPropTweens,
	    add: _addPropTween,
	    kill: _killPropTweensOf,
	    modifier: _addPluginModifier,
	    rawVars: 0
	  },
	      statics = {
	    targetTest: 0,
	    get: 0,
	    getSetter: _getSetter,
	    aliases: {},
	    register: 0
	  };

	  _wake();

	  if (config !== Plugin) {
	    if (_plugins[name]) {
	      return;
	    }

	    _setDefaults(Plugin, _setDefaults(_copyExcluding(config, instanceDefaults), statics)); //static methods


	    _merge(Plugin.prototype, _merge(instanceDefaults, _copyExcluding(config, statics))); //instance methods


	    _plugins[Plugin.prop = name] = Plugin;

	    if (config.targetTest) {
	      _harnessPlugins.push(Plugin);

	      _reservedProps[name] = 1;
	    }

	    name = (name === "css" ? "CSS" : name.charAt(0).toUpperCase() + name.substr(1)) + "Plugin"; //for the global name. "motionPath" should become MotionPathPlugin
	  }

	  _addGlobal(name, Plugin);

	  config.register && config.register(gsap, Plugin, PropTween);
	},

	/*
	 * --------------------------------------------------------------------------------------
	 * COLORS
	 * --------------------------------------------------------------------------------------
	 */
	_255 = 255,
	    _colorLookup = {
	  aqua: [0, _255, _255],
	  lime: [0, _255, 0],
	  silver: [192, 192, 192],
	  black: [0, 0, 0],
	  maroon: [128, 0, 0],
	  teal: [0, 128, 128],
	  blue: [0, 0, _255],
	  navy: [0, 0, 128],
	  white: [_255, _255, _255],
	  olive: [128, 128, 0],
	  yellow: [_255, _255, 0],
	  orange: [_255, 165, 0],
	  gray: [128, 128, 128],
	  purple: [128, 0, 128],
	  green: [0, 128, 0],
	  red: [_255, 0, 0],
	  pink: [_255, 192, 203],
	  cyan: [0, _255, _255],
	  transparent: [_255, _255, _255, 0]
	},
	    _hue = function _hue(h, m1, m2) {
	  h = h < 0 ? h + 1 : h > 1 ? h - 1 : h;
	  return (h * 6 < 1 ? m1 + (m2 - m1) * h * 6 : h < .5 ? m2 : h * 3 < 2 ? m1 + (m2 - m1) * (2 / 3 - h) * 6 : m1) * _255 + .5 | 0;
	},
	    splitColor = function splitColor(v, toHSL, forceAlpha) {
	  var a = !v ? _colorLookup.black : _isNumber(v) ? [v >> 16, v >> 8 & _255, v & _255] : 0,
	      r,
	      g,
	      b,
	      h,
	      s,
	      l,
	      max,
	      min,
	      d,
	      wasHSL;

	  if (!a) {
	    if (v.substr(-1) === ",") {
	      //sometimes a trailing comma is included and we should chop it off (typically from a comma-delimited list of values like a textShadow:"2px 2px 2px blue, 5px 5px 5px rgb(255,0,0)" - in this example "blue," has a trailing comma. We could strip it out inside parseComplex() but we'd need to do it to the beginning and ending values plus it wouldn't provide protection from other potential scenarios like if the user passes in a similar value.
	      v = v.substr(0, v.length - 1);
	    }

	    if (_colorLookup[v]) {
	      a = _colorLookup[v];
	    } else if (v.charAt(0) === "#") {
	      if (v.length < 6) {
	        //for shorthand like #9F0 or #9F0F (could have alpha)
	        r = v.charAt(1);
	        g = v.charAt(2);
	        b = v.charAt(3);
	        v = "#" + r + r + g + g + b + b + (v.length === 5 ? v.charAt(4) + v.charAt(4) : "");
	      }

	      if (v.length === 9) {
	        // hex with alpha, like #fd5e53ff
	        a = parseInt(v.substr(1, 6), 16);
	        return [a >> 16, a >> 8 & _255, a & _255, parseInt(v.substr(7), 16) / 255];
	      }

	      v = parseInt(v.substr(1), 16);
	      a = [v >> 16, v >> 8 & _255, v & _255];
	    } else if (v.substr(0, 3) === "hsl") {
	      a = wasHSL = v.match(_strictNumExp);

	      if (!toHSL) {
	        h = +a[0] % 360 / 360;
	        s = +a[1] / 100;
	        l = +a[2] / 100;
	        g = l <= .5 ? l * (s + 1) : l + s - l * s;
	        r = l * 2 - g;
	        a.length > 3 && (a[3] *= 1); //cast as number

	        a[0] = _hue(h + 1 / 3, r, g);
	        a[1] = _hue(h, r, g);
	        a[2] = _hue(h - 1 / 3, r, g);
	      } else if (~v.indexOf("=")) {
	        //if relative values are found, just return the raw strings with the relative prefixes in place.
	        a = v.match(_numExp);
	        forceAlpha && a.length < 4 && (a[3] = 1);
	        return a;
	      }
	    } else {
	      a = v.match(_strictNumExp) || _colorLookup.transparent;
	    }

	    a = a.map(Number);
	  }

	  if (toHSL && !wasHSL) {
	    r = a[0] / _255;
	    g = a[1] / _255;
	    b = a[2] / _255;
	    max = Math.max(r, g, b);
	    min = Math.min(r, g, b);
	    l = (max + min) / 2;

	    if (max === min) {
	      h = s = 0;
	    } else {
	      d = max - min;
	      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	      h *= 60;
	    }

	    a[0] = ~~(h + .5);
	    a[1] = ~~(s * 100 + .5);
	    a[2] = ~~(l * 100 + .5);
	  }

	  forceAlpha && a.length < 4 && (a[3] = 1);
	  return a;
	},
	    _colorOrderData = function _colorOrderData(v) {
	  // strips out the colors from the string, finds all the numeric slots (with units) and returns an array of those. The Array also has a "c" property which is an Array of the index values where the colors belong. This is to help work around issues where there's a mis-matched order of color/numeric data like drop-shadow(#f00 0px 1px 2px) and drop-shadow(0x 1px 2px #f00). This is basically a helper function used in _formatColors()
	  var values = [],
	      c = [],
	      i = -1;
	  v.split(_colorExp).forEach(function (v) {
	    var a = v.match(_numWithUnitExp) || [];
	    values.push.apply(values, a);
	    c.push(i += a.length + 1);
	  });
	  values.c = c;
	  return values;
	},
	    _formatColors = function _formatColors(s, toHSL, orderMatchData) {
	  var result = "",
	      colors = (s + result).match(_colorExp),
	      type = toHSL ? "hsla(" : "rgba(",
	      i = 0,
	      c,
	      shell,
	      d,
	      l;

	  if (!colors) {
	    return s;
	  }

	  colors = colors.map(function (color) {
	    return (color = splitColor(color, toHSL, 1)) && type + (toHSL ? color[0] + "," + color[1] + "%," + color[2] + "%," + color[3] : color.join(",")) + ")";
	  });

	  if (orderMatchData) {
	    d = _colorOrderData(s);
	    c = orderMatchData.c;

	    if (c.join(result) !== d.c.join(result)) {
	      shell = s.replace(_colorExp, "1").split(_numWithUnitExp);
	      l = shell.length - 1;

	      for (; i < l; i++) {
	        result += shell[i] + (~c.indexOf(i) ? colors.shift() || type + "0,0,0,0)" : (d.length ? d : colors.length ? colors : orderMatchData).shift());
	      }
	    }
	  }

	  if (!shell) {
	    shell = s.split(_colorExp);
	    l = shell.length - 1;

	    for (; i < l; i++) {
	      result += shell[i] + colors[i];
	    }
	  }

	  return result + shell[l];
	},
	    _colorExp = function () {
	  var s = "(?:\\b(?:(?:rgb|rgba|hsl|hsla)\\(.+?\\))|\\B#(?:[0-9a-f]{3,4}){1,2}\\b",
	      //we'll dynamically build this Regular Expression to conserve file size. After building it, it will be able to find rgb(), rgba(), # (hexadecimal), and named color values like red, blue, purple, etc.,
	  p;

	  for (p in _colorLookup) {
	    s += "|" + p + "\\b";
	  }

	  return new RegExp(s + ")", "gi");
	}(),
	    _hslExp = /hsl[a]?\(/,
	    _colorStringFilter = function _colorStringFilter(a) {
	  var combined = a.join(" "),
	      toHSL;
	  _colorExp.lastIndex = 0;

	  if (_colorExp.test(combined)) {
	    toHSL = _hslExp.test(combined);
	    a[1] = _formatColors(a[1], toHSL);
	    a[0] = _formatColors(a[0], toHSL, _colorOrderData(a[1])); // make sure the order of numbers/colors match with the END value.

	    return true;
	  }
	},

	/*
	 * --------------------------------------------------------------------------------------
	 * TICKER
	 * --------------------------------------------------------------------------------------
	 */
	_tickerActive,
	    _ticker = function () {
	  var _getTime = Date.now,
	      _lagThreshold = 500,
	      _adjustedLag = 33,
	      _startTime = _getTime(),
	      _lastUpdate = _startTime,
	      _gap = 1000 / 240,
	      _nextTime = _gap,
	      _listeners = [],
	      _id,
	      _req,
	      _raf,
	      _self,
	      _delta,
	      _i,
	      _tick = function _tick(v) {
	    var elapsed = _getTime() - _lastUpdate,
	        manual = v === true,
	        overlap,
	        dispatch,
	        time,
	        frame;

	    elapsed > _lagThreshold && (_startTime += elapsed - _adjustedLag);
	    _lastUpdate += elapsed;
	    time = _lastUpdate - _startTime;
	    overlap = time - _nextTime;

	    if (overlap > 0 || manual) {
	      frame = ++_self.frame;
	      _delta = time - _self.time * 1000;
	      _self.time = time = time / 1000;
	      _nextTime += overlap + (overlap >= _gap ? 4 : _gap - overlap);
	      dispatch = 1;
	    }

	    manual || (_id = _req(_tick)); //make sure the request is made before we dispatch the "tick" event so that timing is maintained. Otherwise, if processing the "tick" requires a bunch of time (like 15ms) and we're using a setTimeout() that's based on 16.7ms, it'd technically take 31.7ms between frames otherwise.

	    if (dispatch) {
	      for (_i = 0; _i < _listeners.length; _i++) {
	        // use _i and check _listeners.length instead of a variable because a listener could get removed during the loop, and if that happens to an element less than the current index, it'd throw things off in the loop.
	        _listeners[_i](time, _delta, frame, v);
	      }
	    }
	  };

	  _self = {
	    time: 0,
	    frame: 0,
	    tick: function tick() {
	      _tick(true);
	    },
	    deltaRatio: function deltaRatio(fps) {
	      return _delta / (1000 / (fps || 60));
	    },
	    wake: function wake() {
	      if (_coreReady) {
	        if (!_coreInitted && _windowExists$1()) {
	          _win$1 = _coreInitted = window;
	          _doc$1 = _win$1.document || {};
	          _globals.gsap = gsap;
	          (_win$1.gsapVersions || (_win$1.gsapVersions = [])).push(gsap.version);

	          _install(_installScope || _win$1.GreenSockGlobals || !_win$1.gsap && _win$1 || {});

	          _raf = _win$1.requestAnimationFrame;
	        }

	        _id && _self.sleep();

	        _req = _raf || function (f) {
	          return setTimeout(f, _nextTime - _self.time * 1000 + 1 | 0);
	        };

	        _tickerActive = 1;

	        _tick(2);
	      }
	    },
	    sleep: function sleep() {
	      (_raf ? _win$1.cancelAnimationFrame : clearTimeout)(_id);
	      _tickerActive = 0;
	      _req = _emptyFunc;
	    },
	    lagSmoothing: function lagSmoothing(threshold, adjustedLag) {
	      _lagThreshold = threshold || 1 / _tinyNum; //zero should be interpreted as basically unlimited

	      _adjustedLag = Math.min(adjustedLag, _lagThreshold, 0);
	    },
	    fps: function fps(_fps) {
	      _gap = 1000 / (_fps || 240);
	      _nextTime = _self.time * 1000 + _gap;
	    },
	    add: function add(callback) {
	      _listeners.indexOf(callback) < 0 && _listeners.push(callback);

	      _wake();
	    },
	    remove: function remove(callback) {
	      var i;
	      ~(i = _listeners.indexOf(callback)) && _listeners.splice(i, 1) && _i >= i && _i--;
	    },
	    _listeners: _listeners
	  };
	  return _self;
	}(),
	    _wake = function _wake() {
	  return !_tickerActive && _ticker.wake();
	},
	    //also ensures the core classes are initialized.

	/*
	* -------------------------------------------------
	* EASING
	* -------------------------------------------------
	*/
	_easeMap = {},
	    _customEaseExp = /^[\d.\-M][\d.\-,\s]/,
	    _quotesExp = /["']/g,
	    _parseObjectInString = function _parseObjectInString(value) {
	  //takes a string like "{wiggles:10, type:anticipate})" and turns it into a real object. Notice it ends in ")" and includes the {} wrappers. This is because we only use this function for parsing ease configs and prioritized optimization rather than reusability.
	  var obj = {},
	      split = value.substr(1, value.length - 3).split(":"),
	      key = split[0],
	      i = 1,
	      l = split.length,
	      index,
	      val,
	      parsedVal;

	  for (; i < l; i++) {
	    val = split[i];
	    index = i !== l - 1 ? val.lastIndexOf(",") : val.length;
	    parsedVal = val.substr(0, index);
	    obj[key] = isNaN(parsedVal) ? parsedVal.replace(_quotesExp, "").trim() : +parsedVal;
	    key = val.substr(index + 1).trim();
	  }

	  return obj;
	},
	    _valueInParentheses = function _valueInParentheses(value) {
	  var open = value.indexOf("(") + 1,
	      close = value.indexOf(")"),
	      nested = value.indexOf("(", open);
	  return value.substring(open, ~nested && nested < close ? value.indexOf(")", close + 1) : close);
	},
	    _configEaseFromString = function _configEaseFromString(name) {
	  //name can be a string like "elastic.out(1,0.5)", and pass in _easeMap as obj and it'll parse it out and call the actual function like _easeMap.Elastic.easeOut.config(1,0.5). It will also parse custom ease strings as long as CustomEase is loaded and registered (internally as _easeMap._CE).
	  var split = (name + "").split("("),
	      ease = _easeMap[split[0]];
	  return ease && split.length > 1 && ease.config ? ease.config.apply(null, ~name.indexOf("{") ? [_parseObjectInString(split[1])] : _valueInParentheses(name).split(",").map(_numericIfPossible)) : _easeMap._CE && _customEaseExp.test(name) ? _easeMap._CE("", name) : ease;
	},
	    _invertEase = function _invertEase(ease) {
	  return function (p) {
	    return 1 - ease(1 - p);
	  };
	},
	    // allow yoyoEase to be set in children and have those affected when the parent/ancestor timeline yoyos.
	_propagateYoyoEase = function _propagateYoyoEase(timeline, isYoyo) {
	  var child = timeline._first,
	      ease;

	  while (child) {
	    if (child instanceof Timeline) {
	      _propagateYoyoEase(child, isYoyo);
	    } else if (child.vars.yoyoEase && (!child._yoyo || !child._repeat) && child._yoyo !== isYoyo) {
	      if (child.timeline) {
	        _propagateYoyoEase(child.timeline, isYoyo);
	      } else {
	        ease = child._ease;
	        child._ease = child._yEase;
	        child._yEase = ease;
	        child._yoyo = isYoyo;
	      }
	    }

	    child = child._next;
	  }
	},
	    _parseEase = function _parseEase(ease, defaultEase) {
	  return !ease ? defaultEase : (_isFunction(ease) ? ease : _easeMap[ease] || _configEaseFromString(ease)) || defaultEase;
	},
	    _insertEase = function _insertEase(names, easeIn, easeOut, easeInOut) {
	  if (easeOut === void 0) {
	    easeOut = function easeOut(p) {
	      return 1 - easeIn(1 - p);
	    };
	  }

	  if (easeInOut === void 0) {
	    easeInOut = function easeInOut(p) {
	      return p < .5 ? easeIn(p * 2) / 2 : 1 - easeIn((1 - p) * 2) / 2;
	    };
	  }

	  var ease = {
	    easeIn: easeIn,
	    easeOut: easeOut,
	    easeInOut: easeInOut
	  },
	      lowercaseName;

	  _forEachName(names, function (name) {
	    _easeMap[name] = _globals[name] = ease;
	    _easeMap[lowercaseName = name.toLowerCase()] = easeOut;

	    for (var p in ease) {
	      _easeMap[lowercaseName + (p === "easeIn" ? ".in" : p === "easeOut" ? ".out" : ".inOut")] = _easeMap[name + "." + p] = ease[p];
	    }
	  });

	  return ease;
	},
	    _easeInOutFromOut = function _easeInOutFromOut(easeOut) {
	  return function (p) {
	    return p < .5 ? (1 - easeOut(1 - p * 2)) / 2 : .5 + easeOut((p - .5) * 2) / 2;
	  };
	},
	    _configElastic = function _configElastic(type, amplitude, period) {
	  var p1 = amplitude >= 1 ? amplitude : 1,
	      //note: if amplitude is < 1, we simply adjust the period for a more natural feel. Otherwise the math doesn't work right and the curve starts at 1.
	  p2 = (period || (type ? .3 : .45)) / (amplitude < 1 ? amplitude : 1),
	      p3 = p2 / _2PI * (Math.asin(1 / p1) || 0),
	      easeOut = function easeOut(p) {
	    return p === 1 ? 1 : p1 * Math.pow(2, -10 * p) * _sin((p - p3) * p2) + 1;
	  },
	      ease = type === "out" ? easeOut : type === "in" ? function (p) {
	    return 1 - easeOut(1 - p);
	  } : _easeInOutFromOut(easeOut);

	  p2 = _2PI / p2; //precalculate to optimize

	  ease.config = function (amplitude, period) {
	    return _configElastic(type, amplitude, period);
	  };

	  return ease;
	},
	    _configBack = function _configBack(type, overshoot) {
	  if (overshoot === void 0) {
	    overshoot = 1.70158;
	  }

	  var easeOut = function easeOut(p) {
	    return p ? --p * p * ((overshoot + 1) * p + overshoot) + 1 : 0;
	  },
	      ease = type === "out" ? easeOut : type === "in" ? function (p) {
	    return 1 - easeOut(1 - p);
	  } : _easeInOutFromOut(easeOut);

	  ease.config = function (overshoot) {
	    return _configBack(type, overshoot);
	  };

	  return ease;
	}; // a cheaper (kb and cpu) but more mild way to get a parameterized weighted ease by feeding in a value between -1 (easeIn) and 1 (easeOut) where 0 is linear.
	// _weightedEase = ratio => {
	// 	let y = 0.5 + ratio / 2;
	// 	return p => (2 * (1 - p) * p * y + p * p);
	// },
	// a stronger (but more expensive kb/cpu) parameterized weighted ease that lets you feed in a value between -1 (easeIn) and 1 (easeOut) where 0 is linear.
	// _weightedEaseStrong = ratio => {
	// 	ratio = .5 + ratio / 2;
	// 	let o = 1 / 3 * (ratio < .5 ? ratio : 1 - ratio),
	// 		b = ratio - o,
	// 		c = ratio + o;
	// 	return p => p === 1 ? p : 3 * b * (1 - p) * (1 - p) * p + 3 * c * (1 - p) * p * p + p * p * p;
	// };


	_forEachName("Linear,Quad,Cubic,Quart,Quint,Strong", function (name, i) {
	  var power = i < 5 ? i + 1 : i;

	  _insertEase(name + ",Power" + (power - 1), i ? function (p) {
	    return Math.pow(p, power);
	  } : function (p) {
	    return p;
	  }, function (p) {
	    return 1 - Math.pow(1 - p, power);
	  }, function (p) {
	    return p < .5 ? Math.pow(p * 2, power) / 2 : 1 - Math.pow((1 - p) * 2, power) / 2;
	  });
	});

	_easeMap.Linear.easeNone = _easeMap.none = _easeMap.Linear.easeIn;

	_insertEase("Elastic", _configElastic("in"), _configElastic("out"), _configElastic());

	(function (n, c) {
	  var n1 = 1 / c,
	      n2 = 2 * n1,
	      n3 = 2.5 * n1,
	      easeOut = function easeOut(p) {
	    return p < n1 ? n * p * p : p < n2 ? n * Math.pow(p - 1.5 / c, 2) + .75 : p < n3 ? n * (p -= 2.25 / c) * p + .9375 : n * Math.pow(p - 2.625 / c, 2) + .984375;
	  };

	  _insertEase("Bounce", function (p) {
	    return 1 - easeOut(1 - p);
	  }, easeOut);
	})(7.5625, 2.75);

	_insertEase("Expo", function (p) {
	  return p ? Math.pow(2, 10 * (p - 1)) : 0;
	});

	_insertEase("Circ", function (p) {
	  return -(_sqrt(1 - p * p) - 1);
	});

	_insertEase("Sine", function (p) {
	  return p === 1 ? 1 : -_cos(p * _HALF_PI) + 1;
	});

	_insertEase("Back", _configBack("in"), _configBack("out"), _configBack());

	_easeMap.SteppedEase = _easeMap.steps = _globals.SteppedEase = {
	  config: function config(steps, immediateStart) {
	    if (steps === void 0) {
	      steps = 1;
	    }

	    var p1 = 1 / steps,
	        p2 = steps + (immediateStart ? 0 : 1),
	        p3 = immediateStart ? 1 : 0,
	        max = 1 - _tinyNum;
	    return function (p) {
	      return ((p2 * _clamp(0, max, p) | 0) + p3) * p1;
	    };
	  }
	};
	_defaults.ease = _easeMap["quad.out"];

	_forEachName("onComplete,onUpdate,onStart,onRepeat,onReverseComplete,onInterrupt", function (name) {
	  return _callbackNames += name + "," + name + "Params,";
	});
	/*
	 * --------------------------------------------------------------------------------------
	 * CACHE
	 * --------------------------------------------------------------------------------------
	 */


	var GSCache = function GSCache(target, harness) {
	  this.id = _gsID++;
	  target._gsap = this;
	  this.target = target;
	  this.harness = harness;
	  this.get = harness ? harness.get : _getProperty;
	  this.set = harness ? harness.getSetter : _getSetter;
	};
	/*
	 * --------------------------------------------------------------------------------------
	 * ANIMATION
	 * --------------------------------------------------------------------------------------
	 */

	var Animation = /*#__PURE__*/function () {
	  function Animation(vars) {
	    this.vars = vars;
	    this._delay = +vars.delay || 0;

	    if (this._repeat = vars.repeat === Infinity ? -2 : vars.repeat || 0) {
	      // TODO: repeat: Infinity on a timeline's children must flag that timeline internally and affect its totalDuration, otherwise it'll stop in the negative direction when reaching the start.
	      this._rDelay = vars.repeatDelay || 0;
	      this._yoyo = !!vars.yoyo || !!vars.yoyoEase;
	    }

	    this._ts = 1;

	    _setDuration(this, +vars.duration, 1, 1);

	    this.data = vars.data;
	    _tickerActive || _ticker.wake();
	  }

	  var _proto = Animation.prototype;

	  _proto.delay = function delay(value) {
	    if (value || value === 0) {
	      this.parent && this.parent.smoothChildTiming && this.startTime(this._start + value - this._delay);
	      this._delay = value;
	      return this;
	    }

	    return this._delay;
	  };

	  _proto.duration = function duration(value) {
	    return arguments.length ? this.totalDuration(this._repeat > 0 ? value + (value + this._rDelay) * this._repeat : value) : this.totalDuration() && this._dur;
	  };

	  _proto.totalDuration = function totalDuration(value) {
	    if (!arguments.length) {
	      return this._tDur;
	    }

	    this._dirty = 0;
	    return _setDuration(this, this._repeat < 0 ? value : (value - this._repeat * this._rDelay) / (this._repeat + 1));
	  };

	  _proto.totalTime = function totalTime(_totalTime, suppressEvents) {
	    _wake();

	    if (!arguments.length) {
	      return this._tTime;
	    }

	    var parent = this._dp;

	    if (parent && parent.smoothChildTiming && this._ts) {
	      _alignPlayhead(this, _totalTime);

	      !parent._dp || parent.parent || _postAddChecks(parent, this); // edge case: if this is a child of a timeline that already completed, for example, we must re-activate the parent.
	      //in case any of the ancestor timelines had completed but should now be enabled, we should reset their totalTime() which will also ensure that they're lined up properly and enabled. Skip for animations that are on the root (wasteful). Example: a TimelineLite.exportRoot() is performed when there's a paused tween on the root, the export will not complete until that tween is unpaused, but imagine a child gets restarted later, after all [unpaused] tweens have completed. The start of that child would get pushed out, but one of the ancestors may have completed.

	      while (parent && parent.parent) {
	        if (parent.parent._time !== parent._start + (parent._ts >= 0 ? parent._tTime / parent._ts : (parent.totalDuration() - parent._tTime) / -parent._ts)) {
	          parent.totalTime(parent._tTime, true);
	        }

	        parent = parent.parent;
	      }

	      if (!this.parent && this._dp.autoRemoveChildren && (this._ts > 0 && _totalTime < this._tDur || this._ts < 0 && _totalTime > 0 || !this._tDur && !_totalTime)) {
	        //if the animation doesn't have a parent, put it back into its last parent (recorded as _dp for exactly cases like this). Limit to parents with autoRemoveChildren (like globalTimeline) so that if the user manually removes an animation from a timeline and then alters its playhead, it doesn't get added back in.
	        _addToTimeline(this._dp, this, this._start - this._delay);
	      }
	    }

	    if (this._tTime !== _totalTime || !this._dur && !suppressEvents || this._initted && Math.abs(this._zTime) === _tinyNum || !_totalTime && !this._initted && (this.add || this._ptLookup)) {
	      // check for _ptLookup on a Tween instance to ensure it has actually finished being instantiated, otherwise if this.reverse() gets called in the Animation constructor, it could trigger a render() here even though the _targets weren't populated, thus when _init() is called there won't be any PropTweens (it'll act like the tween is non-functional)
	      this._ts || (this._pTime = _totalTime); // otherwise, if an animation is paused, then the playhead is moved back to zero, then resumed, it'd revert back to the original time at the pause
	      //if (!this._lock) { // avoid endless recursion (not sure we need this yet or if it's worth the performance hit)
	      //   this._lock = 1;

	      _lazySafeRender(this, _totalTime, suppressEvents); //   this._lock = 0;
	      //}

	    }

	    return this;
	  };

	  _proto.time = function time(value, suppressEvents) {
	    return arguments.length ? this.totalTime(Math.min(this.totalDuration(), value + _elapsedCycleDuration(this)) % (this._dur + this._rDelay) || (value ? this._dur : 0), suppressEvents) : this._time; // note: if the modulus results in 0, the playhead could be exactly at the end or the beginning, and we always defer to the END with a non-zero value, otherwise if you set the time() to the very end (duration()), it would render at the START!
	  };

	  _proto.totalProgress = function totalProgress(value, suppressEvents) {
	    return arguments.length ? this.totalTime(this.totalDuration() * value, suppressEvents) : this.totalDuration() ? Math.min(1, this._tTime / this._tDur) : this.ratio;
	  };

	  _proto.progress = function progress(value, suppressEvents) {
	    return arguments.length ? this.totalTime(this.duration() * (this._yoyo && !(this.iteration() & 1) ? 1 - value : value) + _elapsedCycleDuration(this), suppressEvents) : this.duration() ? Math.min(1, this._time / this._dur) : this.ratio;
	  };

	  _proto.iteration = function iteration(value, suppressEvents) {
	    var cycleDuration = this.duration() + this._rDelay;

	    return arguments.length ? this.totalTime(this._time + (value - 1) * cycleDuration, suppressEvents) : this._repeat ? _animationCycle(this._tTime, cycleDuration) + 1 : 1;
	  } // potential future addition:
	  // isPlayingBackwards() {
	  // 	let animation = this,
	  // 		orientation = 1; // 1 = forward, -1 = backward
	  // 	while (animation) {
	  // 		orientation *= animation.reversed() || (animation.repeat() && !(animation.iteration() & 1)) ? -1 : 1;
	  // 		animation = animation.parent;
	  // 	}
	  // 	return orientation < 0;
	  // }
	  ;

	  _proto.timeScale = function timeScale(value) {
	    if (!arguments.length) {
	      return this._rts === -_tinyNum ? 0 : this._rts; // recorded timeScale. Special case: if someone calls reverse() on an animation with timeScale of 0, we assign it -_tinyNum to remember it's reversed.
	    }

	    if (this._rts === value) {
	      return this;
	    }

	    var tTime = this.parent && this._ts ? _parentToChildTotalTime(this.parent._time, this) : this._tTime; // make sure to do the parentToChildTotalTime() BEFORE setting the new _ts because the old one must be used in that calculation.
	    // future addition? Up side: fast and minimal file size. Down side: only works on this animation; if a timeline is reversed, for example, its childrens' onReverse wouldn't get called.
	    //(+value < 0 && this._rts >= 0) && _callback(this, "onReverse", true);
	    // prioritize rendering where the parent's playhead lines up instead of this._tTime because there could be a tween that's animating another tween's timeScale in the same rendering loop (same parent), thus if the timeScale tween renders first, it would alter _start BEFORE _tTime was set on that tick (in the rendering loop), effectively freezing it until the timeScale tween finishes.

	    this._rts = +value || 0;
	    this._ts = this._ps || value === -_tinyNum ? 0 : this._rts; // _ts is the functional timeScale which would be 0 if the animation is paused.

	    _recacheAncestors(this.totalTime(_clamp(-this._delay, this._tDur, tTime), true));

	    _setEnd(this); // if parent.smoothChildTiming was false, the end time didn't get updated in the _alignPlayhead() method, so do it here.


	    return this;
	  };

	  _proto.paused = function paused(value) {
	    if (!arguments.length) {
	      return this._ps;
	    }

	    if (this._ps !== value) {
	      this._ps = value;

	      if (value) {
	        this._pTime = this._tTime || Math.max(-this._delay, this.rawTime()); // if the pause occurs during the delay phase, make sure that's factored in when resuming.

	        this._ts = this._act = 0; // _ts is the functional timeScale, so a paused tween would effectively have a timeScale of 0. We record the "real" timeScale as _rts (recorded time scale)
	      } else {
	        _wake();

	        this._ts = this._rts; //only defer to _pTime (pauseTime) if tTime is zero. Remember, someone could pause() an animation, then scrub the playhead and resume(). If the parent doesn't have smoothChildTiming, we render at the rawTime() because the startTime won't get updated.

	        this.totalTime(this.parent && !this.parent.smoothChildTiming ? this.rawTime() : this._tTime || this._pTime, this.progress() === 1 && Math.abs(this._zTime) !== _tinyNum && (this._tTime -= _tinyNum)); // edge case: animation.progress(1).pause().play() wouldn't render again because the playhead is already at the end, but the call to totalTime() below will add it back to its parent...and not remove it again (since removing only happens upon rendering at a new time). Offsetting the _tTime slightly is done simply to cause the final render in totalTime() that'll pop it off its timeline (if autoRemoveChildren is true, of course). Check to make sure _zTime isn't -_tinyNum to avoid an edge case where the playhead is pushed to the end but INSIDE a tween/callback, the timeline itself is paused thus halting rendering and leaving a few unrendered. When resuming, it wouldn't render those otherwise.
	      }
	    }

	    return this;
	  };

	  _proto.startTime = function startTime(value) {
	    if (arguments.length) {
	      this._start = value;
	      var parent = this.parent || this._dp;
	      parent && (parent._sort || !this.parent) && _addToTimeline(parent, this, value - this._delay);
	      return this;
	    }

	    return this._start;
	  };

	  _proto.endTime = function endTime(includeRepeats) {
	    return this._start + (_isNotFalse(includeRepeats) ? this.totalDuration() : this.duration()) / Math.abs(this._ts || 1);
	  };

	  _proto.rawTime = function rawTime(wrapRepeats) {
	    var parent = this.parent || this._dp; // _dp = detached parent

	    return !parent ? this._tTime : wrapRepeats && (!this._ts || this._repeat && this._time && this.totalProgress() < 1) ? this._tTime % (this._dur + this._rDelay) : !this._ts ? this._tTime : _parentToChildTotalTime(parent.rawTime(wrapRepeats), this);
	  };

	  _proto.globalTime = function globalTime(rawTime) {
	    var animation = this,
	        time = arguments.length ? rawTime : animation.rawTime();

	    while (animation) {
	      time = animation._start + time / (animation._ts || 1);
	      animation = animation._dp;
	    }

	    return time;
	  };

	  _proto.repeat = function repeat(value) {
	    if (arguments.length) {
	      this._repeat = value === Infinity ? -2 : value;
	      return _onUpdateTotalDuration(this);
	    }

	    return this._repeat === -2 ? Infinity : this._repeat;
	  };

	  _proto.repeatDelay = function repeatDelay(value) {
	    if (arguments.length) {
	      var time = this._time;
	      this._rDelay = value;

	      _onUpdateTotalDuration(this);

	      return time ? this.time(time) : this;
	    }

	    return this._rDelay;
	  };

	  _proto.yoyo = function yoyo(value) {
	    if (arguments.length) {
	      this._yoyo = value;
	      return this;
	    }

	    return this._yoyo;
	  };

	  _proto.seek = function seek(position, suppressEvents) {
	    return this.totalTime(_parsePosition(this, position), _isNotFalse(suppressEvents));
	  };

	  _proto.restart = function restart(includeDelay, suppressEvents) {
	    return this.play().totalTime(includeDelay ? -this._delay : 0, _isNotFalse(suppressEvents));
	  };

	  _proto.play = function play(from, suppressEvents) {
	    from != null && this.seek(from, suppressEvents);
	    return this.reversed(false).paused(false);
	  };

	  _proto.reverse = function reverse(from, suppressEvents) {
	    from != null && this.seek(from || this.totalDuration(), suppressEvents);
	    return this.reversed(true).paused(false);
	  };

	  _proto.pause = function pause(atTime, suppressEvents) {
	    atTime != null && this.seek(atTime, suppressEvents);
	    return this.paused(true);
	  };

	  _proto.resume = function resume() {
	    return this.paused(false);
	  };

	  _proto.reversed = function reversed(value) {
	    if (arguments.length) {
	      !!value !== this.reversed() && this.timeScale(-this._rts || (value ? -_tinyNum : 0)); // in case timeScale is zero, reversing would have no effect so we use _tinyNum.

	      return this;
	    }

	    return this._rts < 0;
	  };

	  _proto.invalidate = function invalidate() {
	    this._initted = this._act = 0;
	    this._zTime = -_tinyNum;
	    return this;
	  };

	  _proto.isActive = function isActive() {
	    var parent = this.parent || this._dp,
	        start = this._start,
	        rawTime;
	    return !!(!parent || this._ts && this._initted && parent.isActive() && (rawTime = parent.rawTime(true)) >= start && rawTime < this.endTime(true) - _tinyNum);
	  };

	  _proto.eventCallback = function eventCallback(type, callback, params) {
	    var vars = this.vars;

	    if (arguments.length > 1) {
	      if (!callback) {
	        delete vars[type];
	      } else {
	        vars[type] = callback;
	        params && (vars[type + "Params"] = params);
	        type === "onUpdate" && (this._onUpdate = callback);
	      }

	      return this;
	    }

	    return vars[type];
	  };

	  _proto.then = function then(onFulfilled) {
	    var self = this;
	    return new Promise(function (resolve) {
	      var f = _isFunction(onFulfilled) ? onFulfilled : _passThrough,
	          _resolve = function _resolve() {
	        var _then = self.then;
	        self.then = null; // temporarily null the then() method to avoid an infinite loop (see https://github.com/greensock/GSAP/issues/322)

	        _isFunction(f) && (f = f(self)) && (f.then || f === self) && (self.then = _then);
	        resolve(f);
	        self.then = _then;
	      };

	      if (self._initted && self.totalProgress() === 1 && self._ts >= 0 || !self._tTime && self._ts < 0) {
	        _resolve();
	      } else {
	        self._prom = _resolve;
	      }
	    });
	  };

	  _proto.kill = function kill() {
	    _interrupt(this);
	  };

	  return Animation;
	}();

	_setDefaults(Animation.prototype, {
	  _time: 0,
	  _start: 0,
	  _end: 0,
	  _tTime: 0,
	  _tDur: 0,
	  _dirty: 0,
	  _repeat: 0,
	  _yoyo: false,
	  parent: null,
	  _initted: false,
	  _rDelay: 0,
	  _ts: 1,
	  _dp: 0,
	  ratio: 0,
	  _zTime: -_tinyNum,
	  _prom: 0,
	  _ps: false,
	  _rts: 1
	});
	/*
	 * -------------------------------------------------
	 * TIMELINE
	 * -------------------------------------------------
	 */


	var Timeline = /*#__PURE__*/function (_Animation) {
	  _inheritsLoose(Timeline, _Animation);

	  function Timeline(vars, position) {
	    var _this;

	    if (vars === void 0) {
	      vars = {};
	    }

	    _this = _Animation.call(this, vars) || this;
	    _this.labels = {};
	    _this.smoothChildTiming = !!vars.smoothChildTiming;
	    _this.autoRemoveChildren = !!vars.autoRemoveChildren;
	    _this._sort = _isNotFalse(vars.sortChildren);
	    _globalTimeline && _addToTimeline(vars.parent || _globalTimeline, _assertThisInitialized(_this), position);
	    vars.reversed && _this.reverse();
	    vars.paused && _this.paused(true);
	    vars.scrollTrigger && _scrollTrigger(_assertThisInitialized(_this), vars.scrollTrigger);
	    return _this;
	  }

	  var _proto2 = Timeline.prototype;

	  _proto2.to = function to(targets, vars, position) {
	    _createTweenType(0, arguments, this);

	    return this;
	  };

	  _proto2.from = function from(targets, vars, position) {
	    _createTweenType(1, arguments, this);

	    return this;
	  };

	  _proto2.fromTo = function fromTo(targets, fromVars, toVars, position) {
	    _createTweenType(2, arguments, this);

	    return this;
	  };

	  _proto2.set = function set(targets, vars, position) {
	    vars.duration = 0;
	    vars.parent = this;
	    _inheritDefaults(vars).repeatDelay || (vars.repeat = 0);
	    vars.immediateRender = !!vars.immediateRender;
	    new Tween(targets, vars, _parsePosition(this, position), 1);
	    return this;
	  };

	  _proto2.call = function call(callback, params, position) {
	    return _addToTimeline(this, Tween.delayedCall(0, callback, params), position);
	  } //ONLY for backward compatibility! Maybe delete?
	  ;

	  _proto2.staggerTo = function staggerTo(targets, duration, vars, stagger, position, onCompleteAll, onCompleteAllParams) {
	    vars.duration = duration;
	    vars.stagger = vars.stagger || stagger;
	    vars.onComplete = onCompleteAll;
	    vars.onCompleteParams = onCompleteAllParams;
	    vars.parent = this;
	    new Tween(targets, vars, _parsePosition(this, position));
	    return this;
	  };

	  _proto2.staggerFrom = function staggerFrom(targets, duration, vars, stagger, position, onCompleteAll, onCompleteAllParams) {
	    vars.runBackwards = 1;
	    _inheritDefaults(vars).immediateRender = _isNotFalse(vars.immediateRender);
	    return this.staggerTo(targets, duration, vars, stagger, position, onCompleteAll, onCompleteAllParams);
	  };

	  _proto2.staggerFromTo = function staggerFromTo(targets, duration, fromVars, toVars, stagger, position, onCompleteAll, onCompleteAllParams) {
	    toVars.startAt = fromVars;
	    _inheritDefaults(toVars).immediateRender = _isNotFalse(toVars.immediateRender);
	    return this.staggerTo(targets, duration, toVars, stagger, position, onCompleteAll, onCompleteAllParams);
	  };

	  _proto2.render = function render(totalTime, suppressEvents, force) {
	    var prevTime = this._time,
	        tDur = this._dirty ? this.totalDuration() : this._tDur,
	        dur = this._dur,
	        tTime = totalTime <= 0 ? 0 : _roundPrecise(totalTime),
	        // if a paused timeline is resumed (or its _start is updated for another reason...which rounds it), that could result in the playhead shifting a **tiny** amount and a zero-duration child at that spot may get rendered at a different ratio, like its totalTime in render() may be 1e-17 instead of 0, for example.
	    crossingStart = this._zTime < 0 !== totalTime < 0 && (this._initted || !dur),
	        time,
	        child,
	        next,
	        iteration,
	        cycleDuration,
	        prevPaused,
	        pauseTween,
	        timeScale,
	        prevStart,
	        prevIteration,
	        yoyo,
	        isYoyo;
	    this !== _globalTimeline && tTime > tDur && totalTime >= 0 && (tTime = tDur);

	    if (tTime !== this._tTime || force || crossingStart) {
	      if (prevTime !== this._time && dur) {
	        //if totalDuration() finds a child with a negative startTime and smoothChildTiming is true, things get shifted around internally so we need to adjust the time accordingly. For example, if a tween starts at -30 we must shift EVERYTHING forward 30 seconds and move this timeline's startTime backward by 30 seconds so that things align with the playhead (no jump).
	        tTime += this._time - prevTime;
	        totalTime += this._time - prevTime;
	      }

	      time = tTime;
	      prevStart = this._start;
	      timeScale = this._ts;
	      prevPaused = !timeScale;

	      if (crossingStart) {
	        dur || (prevTime = this._zTime); //when the playhead arrives at EXACTLY time 0 (right on top) of a zero-duration timeline, we need to discern if events are suppressed so that when the playhead moves again (next time), it'll trigger the callback. If events are NOT suppressed, obviously the callback would be triggered in this render. Basically, the callback should fire either when the playhead ARRIVES or LEAVES this exact spot, not both. Imagine doing a timeline.seek(0) and there's a callback that sits at 0. Since events are suppressed on that seek() by default, nothing will fire, but when the playhead moves off of that position, the callback should fire. This behavior is what people intuitively expect.

	        (totalTime || !suppressEvents) && (this._zTime = totalTime);
	      }

	      if (this._repeat) {
	        //adjust the time for repeats and yoyos
	        yoyo = this._yoyo;
	        cycleDuration = dur + this._rDelay;

	        if (this._repeat < -1 && totalTime < 0) {
	          return this.totalTime(cycleDuration * 100 + totalTime, suppressEvents, force);
	        }

	        time = _roundPrecise(tTime % cycleDuration); //round to avoid floating point errors. (4 % 0.8 should be 0 but some browsers report it as 0.79999999!)

	        if (tTime === tDur) {
	          // the tDur === tTime is for edge cases where there's a lengthy decimal on the duration and it may reach the very end but the time is rendered as not-quite-there (remember, tDur is rounded to 4 decimals whereas dur isn't)
	          iteration = this._repeat;
	          time = dur;
	        } else {
	          iteration = ~~(tTime / cycleDuration);

	          if (iteration && iteration === tTime / cycleDuration) {
	            time = dur;
	            iteration--;
	          }

	          time > dur && (time = dur);
	        }

	        prevIteration = _animationCycle(this._tTime, cycleDuration);
	        !prevTime && this._tTime && prevIteration !== iteration && (prevIteration = iteration); // edge case - if someone does addPause() at the very beginning of a repeating timeline, that pause is technically at the same spot as the end which causes this._time to get set to 0 when the totalTime would normally place the playhead at the end. See https://greensock.com/forums/topic/23823-closing-nav-animation-not-working-on-ie-and-iphone-6-maybe-other-older-browser/?tab=comments#comment-113005

	        if (yoyo && iteration & 1) {
	          time = dur - time;
	          isYoyo = 1;
	        }
	        /*
	        make sure children at the end/beginning of the timeline are rendered properly. If, for example,
	        a 3-second long timeline rendered at 2.9 seconds previously, and now renders at 3.2 seconds (which
	        would get translated to 2.8 seconds if the timeline yoyos or 0.2 seconds if it just repeats), there
	        could be a callback or a short tween that's at 2.95 or 3 seconds in which wouldn't render. So
	        we need to push the timeline to the end (and/or beginning depending on its yoyo value). Also we must
	        ensure that zero-duration tweens at the very beginning or end of the Timeline work.
	        */


	        if (iteration !== prevIteration && !this._lock) {
	          var rewinding = yoyo && prevIteration & 1,
	              doesWrap = rewinding === (yoyo && iteration & 1);
	          iteration < prevIteration && (rewinding = !rewinding);
	          prevTime = rewinding ? 0 : dur;
	          this._lock = 1;
	          this.render(prevTime || (isYoyo ? 0 : _roundPrecise(iteration * cycleDuration)), suppressEvents, !dur)._lock = 0;
	          this._tTime = tTime; // if a user gets the iteration() inside the onRepeat, for example, it should be accurate.

	          !suppressEvents && this.parent && _callback(this, "onRepeat");
	          this.vars.repeatRefresh && !isYoyo && (this.invalidate()._lock = 1);

	          if (prevTime && prevTime !== this._time || prevPaused !== !this._ts || this.vars.onRepeat && !this.parent && !this._act) {
	            // if prevTime is 0 and we render at the very end, _time will be the end, thus won't match. So in this edge case, prevTime won't match _time but that's okay. If it gets killed in the onRepeat, eject as well.
	            return this;
	          }

	          dur = this._dur; // in case the duration changed in the onRepeat

	          tDur = this._tDur;

	          if (doesWrap) {
	            this._lock = 2;
	            prevTime = rewinding ? dur : -0.0001;
	            this.render(prevTime, true);
	            this.vars.repeatRefresh && !isYoyo && this.invalidate();
	          }

	          this._lock = 0;

	          if (!this._ts && !prevPaused) {
	            return this;
	          } //in order for yoyoEase to work properly when there's a stagger, we must swap out the ease in each sub-tween.


	          _propagateYoyoEase(this, isYoyo);
	        }
	      }

	      if (this._hasPause && !this._forcing && this._lock < 2) {
	        pauseTween = _findNextPauseTween(this, _roundPrecise(prevTime), _roundPrecise(time));

	        if (pauseTween) {
	          tTime -= time - (time = pauseTween._start);
	        }
	      }

	      this._tTime = tTime;
	      this._time = time;
	      this._act = !timeScale; //as long as it's not paused, force it to be active so that if the user renders independent of the parent timeline, it'll be forced to re-render on the next tick.

	      if (!this._initted) {
	        this._onUpdate = this.vars.onUpdate;
	        this._initted = 1;
	        this._zTime = totalTime;
	        prevTime = 0; // upon init, the playhead should always go forward; someone could invalidate() a completed timeline and then if they restart(), that would make child tweens render in reverse order which could lock in the wrong starting values if they build on each other, like tl.to(obj, {x: 100}).to(obj, {x: 0}).
	      }

	      if (!prevTime && time && !suppressEvents) {
	        _callback(this, "onStart");

	        if (this._tTime !== tTime) {
	          // in case the onStart triggered a render at a different spot, eject. Like if someone did animation.pause(0.5) or something inside the onStart.
	          return this;
	        }
	      }

	      if (time >= prevTime && totalTime >= 0) {
	        child = this._first;

	        while (child) {
	          next = child._next;

	          if ((child._act || time >= child._start) && child._ts && pauseTween !== child) {
	            if (child.parent !== this) {
	              // an extreme edge case - the child's render could do something like kill() the "next" one in the linked list, or reparent it. In that case we must re-initiate the whole render to be safe.
	              return this.render(totalTime, suppressEvents, force);
	            }

	            child.render(child._ts > 0 ? (time - child._start) * child._ts : (child._dirty ? child.totalDuration() : child._tDur) + (time - child._start) * child._ts, suppressEvents, force);

	            if (time !== this._time || !this._ts && !prevPaused) {
	              //in case a tween pauses or seeks the timeline when rendering, like inside of an onUpdate/onComplete
	              pauseTween = 0;
	              next && (tTime += this._zTime = -_tinyNum); // it didn't finish rendering, so flag zTime as negative so that so that the next time render() is called it'll be forced (to render any remaining children)

	              break;
	            }
	          }

	          child = next;
	        }
	      } else {
	        child = this._last;
	        var adjustedTime = totalTime < 0 ? totalTime : time; //when the playhead goes backward beyond the start of this timeline, we must pass that information down to the child animations so that zero-duration tweens know whether to render their starting or ending values.

	        while (child) {
	          next = child._prev;

	          if ((child._act || adjustedTime <= child._end) && child._ts && pauseTween !== child) {
	            if (child.parent !== this) {
	              // an extreme edge case - the child's render could do something like kill() the "next" one in the linked list, or reparent it. In that case we must re-initiate the whole render to be safe.
	              return this.render(totalTime, suppressEvents, force);
	            }

	            child.render(child._ts > 0 ? (adjustedTime - child._start) * child._ts : (child._dirty ? child.totalDuration() : child._tDur) + (adjustedTime - child._start) * child._ts, suppressEvents, force);

	            if (time !== this._time || !this._ts && !prevPaused) {
	              //in case a tween pauses or seeks the timeline when rendering, like inside of an onUpdate/onComplete
	              pauseTween = 0;
	              next && (tTime += this._zTime = adjustedTime ? -_tinyNum : _tinyNum); // it didn't finish rendering, so adjust zTime so that so that the next time render() is called it'll be forced (to render any remaining children)

	              break;
	            }
	          }

	          child = next;
	        }
	      }

	      if (pauseTween && !suppressEvents) {
	        this.pause();
	        pauseTween.render(time >= prevTime ? 0 : -_tinyNum)._zTime = time >= prevTime ? 1 : -1;

	        if (this._ts) {
	          //the callback resumed playback! So since we may have held back the playhead due to where the pause is positioned, go ahead and jump to where it's SUPPOSED to be (if no pause happened).
	          this._start = prevStart; //if the pause was at an earlier time and the user resumed in the callback, it could reposition the timeline (changing its startTime), throwing things off slightly, so we make sure the _start doesn't shift.

	          _setEnd(this);

	          return this.render(totalTime, suppressEvents, force);
	        }
	      }

	      this._onUpdate && !suppressEvents && _callback(this, "onUpdate", true);
	      if (tTime === tDur && tDur >= this.totalDuration() || !tTime && prevTime) if (prevStart === this._start || Math.abs(timeScale) !== Math.abs(this._ts)) if (!this._lock) {
	        (totalTime || !dur) && (tTime === tDur && this._ts > 0 || !tTime && this._ts < 0) && _removeFromParent(this, 1); // don't remove if the timeline is reversed and the playhead isn't at 0, otherwise tl.progress(1).reverse() won't work. Only remove if the playhead is at the end and timeScale is positive, or if the playhead is at 0 and the timeScale is negative.

	        if (!suppressEvents && !(totalTime < 0 && !prevTime) && (tTime || prevTime || !tDur)) {
	          _callback(this, tTime === tDur && totalTime >= 0 ? "onComplete" : "onReverseComplete", true);

	          this._prom && !(tTime < tDur && this.timeScale() > 0) && this._prom();
	        }
	      }
	    }

	    return this;
	  };

	  _proto2.add = function add(child, position) {
	    var _this2 = this;

	    _isNumber(position) || (position = _parsePosition(this, position, child));

	    if (!(child instanceof Animation)) {
	      if (_isArray(child)) {
	        child.forEach(function (obj) {
	          return _this2.add(obj, position);
	        });
	        return this;
	      }

	      if (_isString(child)) {
	        return this.addLabel(child, position);
	      }

	      if (_isFunction(child)) {
	        child = Tween.delayedCall(0, child);
	      } else {
	        return this;
	      }
	    }

	    return this !== child ? _addToTimeline(this, child, position) : this; //don't allow a timeline to be added to itself as a child!
	  };

	  _proto2.getChildren = function getChildren(nested, tweens, timelines, ignoreBeforeTime) {
	    if (nested === void 0) {
	      nested = true;
	    }

	    if (tweens === void 0) {
	      tweens = true;
	    }

	    if (timelines === void 0) {
	      timelines = true;
	    }

	    if (ignoreBeforeTime === void 0) {
	      ignoreBeforeTime = -_bigNum$1;
	    }

	    var a = [],
	        child = this._first;

	    while (child) {
	      if (child._start >= ignoreBeforeTime) {
	        if (child instanceof Tween) {
	          tweens && a.push(child);
	        } else {
	          timelines && a.push(child);
	          nested && a.push.apply(a, child.getChildren(true, tweens, timelines));
	        }
	      }

	      child = child._next;
	    }

	    return a;
	  };

	  _proto2.getById = function getById(id) {
	    var animations = this.getChildren(1, 1, 1),
	        i = animations.length;

	    while (i--) {
	      if (animations[i].vars.id === id) {
	        return animations[i];
	      }
	    }
	  };

	  _proto2.remove = function remove(child) {
	    if (_isString(child)) {
	      return this.removeLabel(child);
	    }

	    if (_isFunction(child)) {
	      return this.killTweensOf(child);
	    }

	    _removeLinkedListItem(this, child);

	    if (child === this._recent) {
	      this._recent = this._last;
	    }

	    return _uncache(this);
	  };

	  _proto2.totalTime = function totalTime(_totalTime2, suppressEvents) {
	    if (!arguments.length) {
	      return this._tTime;
	    }

	    this._forcing = 1;

	    if (!this._dp && this._ts) {
	      //special case for the global timeline (or any other that has no parent or detached parent).
	      this._start = _roundPrecise(_ticker.time - (this._ts > 0 ? _totalTime2 / this._ts : (this.totalDuration() - _totalTime2) / -this._ts));
	    }

	    _Animation.prototype.totalTime.call(this, _totalTime2, suppressEvents);

	    this._forcing = 0;
	    return this;
	  };

	  _proto2.addLabel = function addLabel(label, position) {
	    this.labels[label] = _parsePosition(this, position);
	    return this;
	  };

	  _proto2.removeLabel = function removeLabel(label) {
	    delete this.labels[label];
	    return this;
	  };

	  _proto2.addPause = function addPause(position, callback, params) {
	    var t = Tween.delayedCall(0, callback || _emptyFunc, params);
	    t.data = "isPause";
	    this._hasPause = 1;
	    return _addToTimeline(this, t, _parsePosition(this, position));
	  };

	  _proto2.removePause = function removePause(position) {
	    var child = this._first;
	    position = _parsePosition(this, position);

	    while (child) {
	      if (child._start === position && child.data === "isPause") {
	        _removeFromParent(child);
	      }

	      child = child._next;
	    }
	  };

	  _proto2.killTweensOf = function killTweensOf(targets, props, onlyActive) {
	    var tweens = this.getTweensOf(targets, onlyActive),
	        i = tweens.length;

	    while (i--) {
	      _overwritingTween !== tweens[i] && tweens[i].kill(targets, props);
	    }

	    return this;
	  };

	  _proto2.getTweensOf = function getTweensOf(targets, onlyActive) {
	    var a = [],
	        parsedTargets = toArray(targets),
	        child = this._first,
	        isGlobalTime = _isNumber(onlyActive),
	        // a number is interpreted as a global time. If the animation spans
	    children;

	    while (child) {
	      if (child instanceof Tween) {
	        if (_arrayContainsAny(child._targets, parsedTargets) && (isGlobalTime ? (!_overwritingTween || child._initted && child._ts) && child.globalTime(0) <= onlyActive && child.globalTime(child.totalDuration()) > onlyActive : !onlyActive || child.isActive())) {
	          // note: if this is for overwriting, it should only be for tweens that aren't paused and are initted.
	          a.push(child);
	        }
	      } else if ((children = child.getTweensOf(parsedTargets, onlyActive)).length) {
	        a.push.apply(a, children);
	      }

	      child = child._next;
	    }

	    return a;
	  } // potential future feature - targets() on timelines
	  // targets() {
	  // 	let result = [];
	  // 	this.getChildren(true, true, false).forEach(t => result.push(...t.targets()));
	  // 	return result.filter((v, i) => result.indexOf(v) === i);
	  // }
	  ;

	  _proto2.tweenTo = function tweenTo(position, vars) {
	    vars = vars || {};

	    var tl = this,
	        endTime = _parsePosition(tl, position),
	        _vars = vars,
	        startAt = _vars.startAt,
	        _onStart = _vars.onStart,
	        onStartParams = _vars.onStartParams,
	        immediateRender = _vars.immediateRender,
	        initted,
	        tween = Tween.to(tl, _setDefaults({
	      ease: vars.ease || "none",
	      lazy: false,
	      immediateRender: false,
	      time: endTime,
	      overwrite: "auto",
	      duration: vars.duration || Math.abs((endTime - (startAt && "time" in startAt ? startAt.time : tl._time)) / tl.timeScale()) || _tinyNum,
	      onStart: function onStart() {
	        tl.pause();

	        if (!initted) {
	          var duration = vars.duration || Math.abs((endTime - (startAt && "time" in startAt ? startAt.time : tl._time)) / tl.timeScale());
	          tween._dur !== duration && _setDuration(tween, duration, 0, 1).render(tween._time, true, true);
	          initted = 1;
	        }

	        _onStart && _onStart.apply(tween, onStartParams || []); //in case the user had an onStart in the vars - we don't want to overwrite it.
	      }
	    }, vars));

	    return immediateRender ? tween.render(0) : tween;
	  };

	  _proto2.tweenFromTo = function tweenFromTo(fromPosition, toPosition, vars) {
	    return this.tweenTo(toPosition, _setDefaults({
	      startAt: {
	        time: _parsePosition(this, fromPosition)
	      }
	    }, vars));
	  };

	  _proto2.recent = function recent() {
	    return this._recent;
	  };

	  _proto2.nextLabel = function nextLabel(afterTime) {
	    if (afterTime === void 0) {
	      afterTime = this._time;
	    }

	    return _getLabelInDirection(this, _parsePosition(this, afterTime));
	  };

	  _proto2.previousLabel = function previousLabel(beforeTime) {
	    if (beforeTime === void 0) {
	      beforeTime = this._time;
	    }

	    return _getLabelInDirection(this, _parsePosition(this, beforeTime), 1);
	  };

	  _proto2.currentLabel = function currentLabel(value) {
	    return arguments.length ? this.seek(value, true) : this.previousLabel(this._time + _tinyNum);
	  };

	  _proto2.shiftChildren = function shiftChildren(amount, adjustLabels, ignoreBeforeTime) {
	    if (ignoreBeforeTime === void 0) {
	      ignoreBeforeTime = 0;
	    }

	    var child = this._first,
	        labels = this.labels,
	        p;

	    while (child) {
	      if (child._start >= ignoreBeforeTime) {
	        child._start += amount;
	        child._end += amount;
	      }

	      child = child._next;
	    }

	    if (adjustLabels) {
	      for (p in labels) {
	        if (labels[p] >= ignoreBeforeTime) {
	          labels[p] += amount;
	        }
	      }
	    }

	    return _uncache(this);
	  };

	  _proto2.invalidate = function invalidate() {
	    var child = this._first;
	    this._lock = 0;

	    while (child) {
	      child.invalidate();
	      child = child._next;
	    }

	    return _Animation.prototype.invalidate.call(this);
	  };

	  _proto2.clear = function clear(includeLabels) {
	    if (includeLabels === void 0) {
	      includeLabels = true;
	    }

	    var child = this._first,
	        next;

	    while (child) {
	      next = child._next;
	      this.remove(child);
	      child = next;
	    }

	    this._dp && (this._time = this._tTime = this._pTime = 0);
	    includeLabels && (this.labels = {});
	    return _uncache(this);
	  };

	  _proto2.totalDuration = function totalDuration(value) {
	    var max = 0,
	        self = this,
	        child = self._last,
	        prevStart = _bigNum$1,
	        prev,
	        start,
	        parent;

	    if (arguments.length) {
	      return self.timeScale((self._repeat < 0 ? self.duration() : self.totalDuration()) / (self.reversed() ? -value : value));
	    }

	    if (self._dirty) {
	      parent = self.parent;

	      while (child) {
	        prev = child._prev; //record it here in case the tween changes position in the sequence...

	        child._dirty && child.totalDuration(); //could change the tween._startTime, so make sure the animation's cache is clean before analyzing it.

	        start = child._start;

	        if (start > prevStart && self._sort && child._ts && !self._lock) {
	          //in case one of the tweens shifted out of order, it needs to be re-inserted into the correct position in the sequence
	          self._lock = 1; //prevent endless recursive calls - there are methods that get triggered that check duration/totalDuration when we add().

	          _addToTimeline(self, child, start - child._delay, 1)._lock = 0;
	        } else {
	          prevStart = start;
	        }

	        if (start < 0 && child._ts) {
	          //children aren't allowed to have negative startTimes unless smoothChildTiming is true, so adjust here if one is found.
	          max -= start;

	          if (!parent && !self._dp || parent && parent.smoothChildTiming) {
	            self._start += start / self._ts;
	            self._time -= start;
	            self._tTime -= start;
	          }

	          self.shiftChildren(-start, false, -1e999);
	          prevStart = 0;
	        }

	        child._end > max && child._ts && (max = child._end);
	        child = prev;
	      }

	      _setDuration(self, self === _globalTimeline && self._time > max ? self._time : max, 1, 1);

	      self._dirty = 0;
	    }

	    return self._tDur;
	  };

	  Timeline.updateRoot = function updateRoot(time) {
	    if (_globalTimeline._ts) {
	      _lazySafeRender(_globalTimeline, _parentToChildTotalTime(time, _globalTimeline));

	      _lastRenderedFrame = _ticker.frame;
	    }

	    if (_ticker.frame >= _nextGCFrame) {
	      _nextGCFrame += _config.autoSleep || 120;
	      var child = _globalTimeline._first;
	      if (!child || !child._ts) if (_config.autoSleep && _ticker._listeners.length < 2) {
	        while (child && !child._ts) {
	          child = child._next;
	        }

	        child || _ticker.sleep();
	      }
	    }
	  };

	  return Timeline;
	}(Animation);

	_setDefaults(Timeline.prototype, {
	  _lock: 0,
	  _hasPause: 0,
	  _forcing: 0
	});

	var _addComplexStringPropTween = function _addComplexStringPropTween(target, prop, start, end, setter, stringFilter, funcParam) {
	  //note: we call _addComplexStringPropTween.call(tweenInstance...) to ensure that it's scoped properly. We may call it from within a plugin too, thus "this" would refer to the plugin.
	  var pt = new PropTween(this._pt, target, prop, 0, 1, _renderComplexString, null, setter),
	      index = 0,
	      matchIndex = 0,
	      result,
	      startNums,
	      color,
	      endNum,
	      chunk,
	      startNum,
	      hasRandom,
	      a;
	  pt.b = start;
	  pt.e = end;
	  start += ""; //ensure values are strings

	  end += "";

	  if (hasRandom = ~end.indexOf("random(")) {
	    end = _replaceRandom(end);
	  }

	  if (stringFilter) {
	    a = [start, end];
	    stringFilter(a, target, prop); //pass an array with the starting and ending values and let the filter do whatever it needs to the values.

	    start = a[0];
	    end = a[1];
	  }

	  startNums = start.match(_complexStringNumExp) || [];

	  while (result = _complexStringNumExp.exec(end)) {
	    endNum = result[0];
	    chunk = end.substring(index, result.index);

	    if (color) {
	      color = (color + 1) % 5;
	    } else if (chunk.substr(-5) === "rgba(") {
	      color = 1;
	    }

	    if (endNum !== startNums[matchIndex++]) {
	      startNum = parseFloat(startNums[matchIndex - 1]) || 0; //these nested PropTweens are handled in a special way - we'll never actually call a render or setter method on them. We'll just loop through them in the parent complex string PropTween's render method.

	      pt._pt = {
	        _next: pt._pt,
	        p: chunk || matchIndex === 1 ? chunk : ",",
	        //note: SVG spec allows omission of comma/space when a negative sign is wedged between two numbers, like 2.5-5.3 instead of 2.5,-5.3 but when tweening, the negative value may switch to positive, so we insert the comma just in case.
	        s: startNum,
	        c: endNum.charAt(1) === "=" ? parseFloat(endNum.substr(2)) * (endNum.charAt(0) === "-" ? -1 : 1) : parseFloat(endNum) - startNum,
	        m: color && color < 4 ? Math.round : 0
	      };
	      index = _complexStringNumExp.lastIndex;
	    }
	  }

	  pt.c = index < end.length ? end.substring(index, end.length) : ""; //we use the "c" of the PropTween to store the final part of the string (after the last number)

	  pt.fp = funcParam;

	  if (_relExp.test(end) || hasRandom) {
	    pt.e = 0; //if the end string contains relative values or dynamic random(...) values, delete the end it so that on the final render we don't actually set it to the string with += or -= characters (forces it to use the calculated value).
	  }

	  this._pt = pt; //start the linked list with this new PropTween. Remember, we call _addComplexStringPropTween.call(tweenInstance...) to ensure that it's scoped properly. We may call it from within a plugin too, thus "this" would refer to the plugin.

	  return pt;
	},
	    _addPropTween = function _addPropTween(target, prop, start, end, index, targets, modifier, stringFilter, funcParam) {
	  _isFunction(end) && (end = end(index || 0, target, targets));
	  var currentValue = target[prop],
	      parsedStart = start !== "get" ? start : !_isFunction(currentValue) ? currentValue : funcParam ? target[prop.indexOf("set") || !_isFunction(target["get" + prop.substr(3)]) ? prop : "get" + prop.substr(3)](funcParam) : target[prop](),
	      setter = !_isFunction(currentValue) ? _setterPlain : funcParam ? _setterFuncWithParam : _setterFunc,
	      pt;

	  if (_isString(end)) {
	    if (~end.indexOf("random(")) {
	      end = _replaceRandom(end);
	    }

	    if (end.charAt(1) === "=") {
	      pt = parseFloat(parsedStart) + parseFloat(end.substr(2)) * (end.charAt(0) === "-" ? -1 : 1) + (getUnit(parsedStart) || 0);

	      if (pt || pt === 0) {
	        // to avoid isNaN, like if someone passes in a value like "!= whatever"
	        end = pt;
	      }
	    }
	  }

	  if (parsedStart !== end) {
	    if (!isNaN(parsedStart * end) && end !== "") {
	      // fun fact: any number multiplied by "" is evaluated as the number 0!
	      pt = new PropTween(this._pt, target, prop, +parsedStart || 0, end - (parsedStart || 0), typeof currentValue === "boolean" ? _renderBoolean : _renderPlain, 0, setter);
	      funcParam && (pt.fp = funcParam);
	      modifier && pt.modifier(modifier, this, target);
	      return this._pt = pt;
	    }

	    !currentValue && !(prop in target) && _missingPlugin(prop, end);
	    return _addComplexStringPropTween.call(this, target, prop, parsedStart, end, setter, stringFilter || _config.stringFilter, funcParam);
	  }
	},
	    //creates a copy of the vars object and processes any function-based values (putting the resulting values directly into the copy) as well as strings with "random()" in them. It does NOT process relative values.
	_processVars = function _processVars(vars, index, target, targets, tween) {
	  _isFunction(vars) && (vars = _parseFuncOrString(vars, tween, index, target, targets));

	  if (!_isObject(vars) || vars.style && vars.nodeType || _isArray(vars) || _isTypedArray(vars)) {
	    return _isString(vars) ? _parseFuncOrString(vars, tween, index, target, targets) : vars;
	  }

	  var copy = {},
	      p;

	  for (p in vars) {
	    copy[p] = _parseFuncOrString(vars[p], tween, index, target, targets);
	  }

	  return copy;
	},
	    _checkPlugin = function _checkPlugin(property, vars, tween, index, target, targets) {
	  var plugin, pt, ptLookup, i;

	  if (_plugins[property] && (plugin = new _plugins[property]()).init(target, plugin.rawVars ? vars[property] : _processVars(vars[property], index, target, targets, tween), tween, index, targets) !== false) {
	    tween._pt = pt = new PropTween(tween._pt, target, property, 0, 1, plugin.render, plugin, 0, plugin.priority);

	    if (tween !== _quickTween) {
	      ptLookup = tween._ptLookup[tween._targets.indexOf(target)]; //note: we can't use tween._ptLookup[index] because for staggered tweens, the index from the fullTargets array won't match what it is in each individual tween that spawns from the stagger.

	      i = plugin._props.length;

	      while (i--) {
	        ptLookup[plugin._props[i]] = pt;
	      }
	    }
	  }

	  return plugin;
	},
	    _overwritingTween,
	    //store a reference temporarily so we can avoid overwriting itself.
	_initTween = function _initTween(tween, time) {
	  var vars = tween.vars,
	      ease = vars.ease,
	      startAt = vars.startAt,
	      immediateRender = vars.immediateRender,
	      lazy = vars.lazy,
	      onUpdate = vars.onUpdate,
	      onUpdateParams = vars.onUpdateParams,
	      callbackScope = vars.callbackScope,
	      runBackwards = vars.runBackwards,
	      yoyoEase = vars.yoyoEase,
	      keyframes = vars.keyframes,
	      autoRevert = vars.autoRevert,
	      dur = tween._dur,
	      prevStartAt = tween._startAt,
	      targets = tween._targets,
	      parent = tween.parent,
	      fullTargets = parent && parent.data === "nested" ? parent.parent._targets : targets,
	      autoOverwrite = tween._overwrite === "auto" && !_suppressOverwrites,
	      tl = tween.timeline,
	      cleanVars,
	      i,
	      p,
	      pt,
	      target,
	      hasPriority,
	      gsData,
	      harness,
	      plugin,
	      ptLookup,
	      index,
	      harnessVars,
	      overwritten;
	  tl && (!keyframes || !ease) && (ease = "none");
	  tween._ease = _parseEase(ease, _defaults.ease);
	  tween._yEase = yoyoEase ? _invertEase(_parseEase(yoyoEase === true ? ease : yoyoEase, _defaults.ease)) : 0;

	  if (yoyoEase && tween._yoyo && !tween._repeat) {
	    //there must have been a parent timeline with yoyo:true that is currently in its yoyo phase, so flip the eases.
	    yoyoEase = tween._yEase;
	    tween._yEase = tween._ease;
	    tween._ease = yoyoEase;
	  }

	  tween._from = !tl && !!vars.runBackwards; //nested timelines should never run backwards - the backwards-ness is in the child tweens.

	  if (!tl) {
	    //if there's an internal timeline, skip all the parsing because we passed that task down the chain.
	    harness = targets[0] ? _getCache(targets[0]).harness : 0;
	    harnessVars = harness && vars[harness.prop]; //someone may need to specify CSS-specific values AND non-CSS values, like if the element has an "x" property plus it's a standard DOM element. We allow people to distinguish by wrapping plugin-specific stuff in a css:{} object for example.

	    cleanVars = _copyExcluding(vars, _reservedProps);
	    prevStartAt && prevStartAt.render(-1, true).kill();

	    if (startAt) {
	      _removeFromParent(tween._startAt = Tween.set(targets, _setDefaults({
	        data: "isStart",
	        overwrite: false,
	        parent: parent,
	        immediateRender: true,
	        lazy: _isNotFalse(lazy),
	        startAt: null,
	        delay: 0,
	        onUpdate: onUpdate,
	        onUpdateParams: onUpdateParams,
	        callbackScope: callbackScope,
	        stagger: 0
	      }, startAt))); //copy the properties/values into a new object to avoid collisions, like var to = {x:0}, from = {x:500}; timeline.fromTo(e, from, to).fromTo(e, to, from);


	      time < 0 && !immediateRender && !autoRevert && tween._startAt.render(-1, true); // rare edge case, like if a render is forced in the negative direction of a non-initted tween.

	      if (immediateRender) {
	        time > 0 && !autoRevert && (tween._startAt = 0); //tweens that render immediately (like most from() and fromTo() tweens) shouldn't revert when their parent timeline's playhead goes backward past the startTime because the initial render could have happened anytime and it shouldn't be directly correlated to this tween's startTime. Imagine setting up a complex animation where the beginning states of various objects are rendered immediately but the tween doesn't happen for quite some time - if we revert to the starting values as soon as the playhead goes backward past the tween's startTime, it will throw things off visually. Reversion should only happen in Timeline instances where immediateRender was false or when autoRevert is explicitly set to true.

	        if (dur && time <= 0) {
	          time && (tween._zTime = time);
	          return; //we skip initialization here so that overwriting doesn't occur until the tween actually begins. Otherwise, if you create several immediateRender:true tweens of the same target/properties to drop into a Timeline, the last one created would overwrite the first ones because they didn't get placed into the timeline yet before the first render occurs and kicks in overwriting.
	        } // if (time > 0) {
	        // 	autoRevert || (tween._startAt = 0); //tweens that render immediately (like most from() and fromTo() tweens) shouldn't revert when their parent timeline's playhead goes backward past the startTime because the initial render could have happened anytime and it shouldn't be directly correlated to this tween's startTime. Imagine setting up a complex animation where the beginning states of various objects are rendered immediately but the tween doesn't happen for quite some time - if we revert to the starting values as soon as the playhead goes backward past the tween's startTime, it will throw things off visually. Reversion should only happen in Timeline instances where immediateRender was false or when autoRevert is explicitly set to true.
	        // } else if (dur && !(time < 0 && prevStartAt)) {
	        // 	time && (tween._zTime = time);
	        // 	return; //we skip initialization here so that overwriting doesn't occur until the tween actually begins. Otherwise, if you create several immediateRender:true tweens of the same target/properties to drop into a Timeline, the last one created would overwrite the first ones because they didn't get placed into the timeline yet before the first render occurs and kicks in overwriting.
	        // }

	      } else if (autoRevert === false) {
	        tween._startAt = 0;
	      }
	    } else if (runBackwards && dur) {
	      //from() tweens must be handled uniquely: their beginning values must be rendered but we don't want overwriting to occur yet (when time is still 0). Wait until the tween actually begins before doing all the routines like overwriting. At that time, we should render at the END of the tween to ensure that things initialize correctly (remember, from() tweens go backwards)
	      if (prevStartAt) {
	        !autoRevert && (tween._startAt = 0);
	      } else {
	        time && (immediateRender = false); //in rare cases (like if a from() tween runs and then is invalidate()-ed), immediateRender could be true but the initial forced-render gets skipped, so there's no need to force the render in this context when the _time is greater than 0

	        p = _setDefaults({
	          overwrite: false,
	          data: "isFromStart",
	          //we tag the tween with as "isFromStart" so that if [inside a plugin] we need to only do something at the very END of a tween, we have a way of identifying this tween as merely the one that's setting the beginning values for a "from()" tween. For example, clearProps in CSSPlugin should only get applied at the very END of a tween and without this tag, from(...{height:100, clearProps:"height", delay:1}) would wipe the height at the beginning of the tween and after 1 second, it'd kick back in.
	          lazy: immediateRender && _isNotFalse(lazy),
	          immediateRender: immediateRender,
	          //zero-duration tweens render immediately by default, but if we're not specifically instructed to render this tween immediately, we should skip this and merely _init() to record the starting values (rendering them immediately would push them to completion which is wasteful in that case - we'd have to render(-1) immediately after)
	          stagger: 0,
	          parent: parent //ensures that nested tweens that had a stagger are handled properly, like gsap.from(".class", {y:gsap.utils.wrap([-100,100])})

	        }, cleanVars);
	        harnessVars && (p[harness.prop] = harnessVars); // in case someone does something like .from(..., {css:{}})

	        _removeFromParent(tween._startAt = Tween.set(targets, p));

	        time < 0 && tween._startAt.render(-1, true); // rare edge case, like if a render is forced in the negative direction of a non-initted from() tween.

	        if (!immediateRender) {
	          _initTween(tween._startAt, _tinyNum); //ensures that the initial values are recorded

	        } else if (!time) {
	          return;
	        }
	      }
	    }

	    tween._pt = 0;
	    lazy = dur && _isNotFalse(lazy) || lazy && !dur;

	    for (i = 0; i < targets.length; i++) {
	      target = targets[i];
	      gsData = target._gsap || _harness(targets)[i]._gsap;
	      tween._ptLookup[i] = ptLookup = {};
	      _lazyLookup[gsData.id] && _lazyTweens.length && _lazyRender(); //if other tweens of the same target have recently initted but haven't rendered yet, we've got to force the render so that the starting values are correct (imagine populating a timeline with a bunch of sequential tweens and then jumping to the end)

	      index = fullTargets === targets ? i : fullTargets.indexOf(target);

	      if (harness && (plugin = new harness()).init(target, harnessVars || cleanVars, tween, index, fullTargets) !== false) {
	        tween._pt = pt = new PropTween(tween._pt, target, plugin.name, 0, 1, plugin.render, plugin, 0, plugin.priority);

	        plugin._props.forEach(function (name) {
	          ptLookup[name] = pt;
	        });

	        plugin.priority && (hasPriority = 1);
	      }

	      if (!harness || harnessVars) {
	        for (p in cleanVars) {
	          if (_plugins[p] && (plugin = _checkPlugin(p, cleanVars, tween, index, target, fullTargets))) {
	            plugin.priority && (hasPriority = 1);
	          } else {
	            ptLookup[p] = pt = _addPropTween.call(tween, target, p, "get", cleanVars[p], index, fullTargets, 0, vars.stringFilter);
	          }
	        }
	      }

	      tween._op && tween._op[i] && tween.kill(target, tween._op[i]);

	      if (autoOverwrite && tween._pt) {
	        _overwritingTween = tween;

	        _globalTimeline.killTweensOf(target, ptLookup, tween.globalTime(time)); // make sure the overwriting doesn't overwrite THIS tween!!!


	        overwritten = !tween.parent;
	        _overwritingTween = 0;
	      }

	      tween._pt && lazy && (_lazyLookup[gsData.id] = 1);
	    }

	    hasPriority && _sortPropTweensByPriority(tween);
	    tween._onInit && tween._onInit(tween); //plugins like RoundProps must wait until ALL of the PropTweens are instantiated. In the plugin's init() function, it sets the _onInit on the tween instance. May not be pretty/intuitive, but it's fast and keeps file size down.
	  }

	  tween._onUpdate = onUpdate;
	  tween._initted = (!tween._op || tween._pt) && !overwritten; // if overwrittenProps resulted in the entire tween being killed, do NOT flag it as initted or else it may render for one tick.
	},
	    _addAliasesToVars = function _addAliasesToVars(targets, vars) {
	  var harness = targets[0] ? _getCache(targets[0]).harness : 0,
	      propertyAliases = harness && harness.aliases,
	      copy,
	      p,
	      i,
	      aliases;

	  if (!propertyAliases) {
	    return vars;
	  }

	  copy = _merge({}, vars);

	  for (p in propertyAliases) {
	    if (p in copy) {
	      aliases = propertyAliases[p].split(",");
	      i = aliases.length;

	      while (i--) {
	        copy[aliases[i]] = copy[p];
	      }
	    }
	  }

	  return copy;
	},
	    _parseFuncOrString = function _parseFuncOrString(value, tween, i, target, targets) {
	  return _isFunction(value) ? value.call(tween, i, target, targets) : _isString(value) && ~value.indexOf("random(") ? _replaceRandom(value) : value;
	},
	    _staggerTweenProps = _callbackNames + "repeat,repeatDelay,yoyo,repeatRefresh,yoyoEase",
	    _staggerPropsToSkip = (_staggerTweenProps + ",id,stagger,delay,duration,paused,scrollTrigger").split(",");
	/*
	 * --------------------------------------------------------------------------------------
	 * TWEEN
	 * --------------------------------------------------------------------------------------
	 */


	var Tween = /*#__PURE__*/function (_Animation2) {
	  _inheritsLoose(Tween, _Animation2);

	  function Tween(targets, vars, position, skipInherit) {
	    var _this3;

	    if (typeof vars === "number") {
	      position.duration = vars;
	      vars = position;
	      position = null;
	    }

	    _this3 = _Animation2.call(this, skipInherit ? vars : _inheritDefaults(vars)) || this;
	    var _this3$vars = _this3.vars,
	        duration = _this3$vars.duration,
	        delay = _this3$vars.delay,
	        immediateRender = _this3$vars.immediateRender,
	        stagger = _this3$vars.stagger,
	        overwrite = _this3$vars.overwrite,
	        keyframes = _this3$vars.keyframes,
	        defaults = _this3$vars.defaults,
	        scrollTrigger = _this3$vars.scrollTrigger,
	        yoyoEase = _this3$vars.yoyoEase,
	        parent = vars.parent || _globalTimeline,
	        parsedTargets = (_isArray(targets) || _isTypedArray(targets) ? _isNumber(targets[0]) : "length" in vars) ? [targets] : toArray(targets),
	        tl,
	        i,
	        copy,
	        l,
	        p,
	        curTarget,
	        staggerFunc,
	        staggerVarsToMerge;
	    _this3._targets = parsedTargets.length ? _harness(parsedTargets) : _warn("GSAP target " + targets + " not found. https://greensock.com", !_config.nullTargetWarn) || [];
	    _this3._ptLookup = []; //PropTween lookup. An array containing an object for each target, having keys for each tweening property

	    _this3._overwrite = overwrite;

	    if (keyframes || stagger || _isFuncOrString(duration) || _isFuncOrString(delay)) {
	      vars = _this3.vars;
	      tl = _this3.timeline = new Timeline({
	        data: "nested",
	        defaults: defaults || {}
	      });
	      tl.kill();
	      tl.parent = tl._dp = _assertThisInitialized(_this3);
	      tl._start = 0;

	      if (keyframes) {
	        _inheritDefaults(_setDefaults(tl.vars.defaults, {
	          ease: "none"
	        }));

	        stagger ? parsedTargets.forEach(function (t, i) {
	          return keyframes.forEach(function (frame, j) {
	            return tl.to(t, frame, j ? ">" : i * stagger);
	          });
	        }) : keyframes.forEach(function (frame) {
	          return tl.to(parsedTargets, frame, ">");
	        });
	      } else {
	        l = parsedTargets.length;
	        staggerFunc = stagger ? distribute(stagger) : _emptyFunc;

	        if (_isObject(stagger)) {
	          //users can pass in callbacks like onStart/onComplete in the stagger object. These should fire with each individual tween.
	          for (p in stagger) {
	            if (~_staggerTweenProps.indexOf(p)) {
	              staggerVarsToMerge || (staggerVarsToMerge = {});
	              staggerVarsToMerge[p] = stagger[p];
	            }
	          }
	        }

	        for (i = 0; i < l; i++) {
	          copy = {};

	          for (p in vars) {
	            if (_staggerPropsToSkip.indexOf(p) < 0) {
	              copy[p] = vars[p];
	            }
	          }

	          copy.stagger = 0;
	          yoyoEase && (copy.yoyoEase = yoyoEase);
	          staggerVarsToMerge && _merge(copy, staggerVarsToMerge);
	          curTarget = parsedTargets[i]; //don't just copy duration or delay because if they're a string or function, we'd end up in an infinite loop because _isFuncOrString() would evaluate as true in the child tweens, entering this loop, etc. So we parse the value straight from vars and default to 0.

	          copy.duration = +_parseFuncOrString(duration, _assertThisInitialized(_this3), i, curTarget, parsedTargets);
	          copy.delay = (+_parseFuncOrString(delay, _assertThisInitialized(_this3), i, curTarget, parsedTargets) || 0) - _this3._delay;

	          if (!stagger && l === 1 && copy.delay) {
	            // if someone does delay:"random(1, 5)", repeat:-1, for example, the delay shouldn't be inside the repeat.
	            _this3._delay = delay = copy.delay;
	            _this3._start += delay;
	            copy.delay = 0;
	          }

	          tl.to(curTarget, copy, staggerFunc(i, curTarget, parsedTargets));
	        }

	        tl.duration() ? duration = delay = 0 : _this3.timeline = 0; // if the timeline's duration is 0, we don't need a timeline internally!
	      }

	      duration || _this3.duration(duration = tl.duration());
	    } else {
	      _this3.timeline = 0; //speed optimization, faster lookups (no going up the prototype chain)
	    }

	    if (overwrite === true && !_suppressOverwrites) {
	      _overwritingTween = _assertThisInitialized(_this3);

	      _globalTimeline.killTweensOf(parsedTargets);

	      _overwritingTween = 0;
	    }

	    _addToTimeline(parent, _assertThisInitialized(_this3), position);

	    vars.reversed && _this3.reverse();
	    vars.paused && _this3.paused(true);

	    if (immediateRender || !duration && !keyframes && _this3._start === _roundPrecise(parent._time) && _isNotFalse(immediateRender) && _hasNoPausedAncestors(_assertThisInitialized(_this3)) && parent.data !== "nested") {
	      _this3._tTime = -_tinyNum; //forces a render without having to set the render() "force" parameter to true because we want to allow lazying by default (using the "force" parameter always forces an immediate full render)

	      _this3.render(Math.max(0, -delay)); //in case delay is negative

	    }

	    scrollTrigger && _scrollTrigger(_assertThisInitialized(_this3), scrollTrigger);
	    return _this3;
	  }

	  var _proto3 = Tween.prototype;

	  _proto3.render = function render(totalTime, suppressEvents, force) {
	    var prevTime = this._time,
	        tDur = this._tDur,
	        dur = this._dur,
	        tTime = totalTime > tDur - _tinyNum && totalTime >= 0 ? tDur : totalTime < _tinyNum ? 0 : totalTime,
	        time,
	        pt,
	        iteration,
	        cycleDuration,
	        prevIteration,
	        isYoyo,
	        ratio,
	        timeline,
	        yoyoEase;

	    if (!dur) {
	      _renderZeroDurationTween(this, totalTime, suppressEvents, force);
	    } else if (tTime !== this._tTime || !totalTime || force || !this._initted && this._tTime || this._startAt && this._zTime < 0 !== totalTime < 0) {
	      //this senses if we're crossing over the start time, in which case we must record _zTime and force the render, but we do it in this lengthy conditional way for performance reasons (usually we can skip the calculations): this._initted && (this._zTime < 0) !== (totalTime < 0)
	      time = tTime;
	      timeline = this.timeline;

	      if (this._repeat) {
	        //adjust the time for repeats and yoyos
	        cycleDuration = dur + this._rDelay;

	        if (this._repeat < -1 && totalTime < 0) {
	          return this.totalTime(cycleDuration * 100 + totalTime, suppressEvents, force);
	        }

	        time = _roundPrecise(tTime % cycleDuration); //round to avoid floating point errors. (4 % 0.8 should be 0 but some browsers report it as 0.79999999!)

	        if (tTime === tDur) {
	          // the tDur === tTime is for edge cases where there's a lengthy decimal on the duration and it may reach the very end but the time is rendered as not-quite-there (remember, tDur is rounded to 4 decimals whereas dur isn't)
	          iteration = this._repeat;
	          time = dur;
	        } else {
	          iteration = ~~(tTime / cycleDuration);

	          if (iteration && iteration === tTime / cycleDuration) {
	            time = dur;
	            iteration--;
	          }

	          time > dur && (time = dur);
	        }

	        isYoyo = this._yoyo && iteration & 1;

	        if (isYoyo) {
	          yoyoEase = this._yEase;
	          time = dur - time;
	        }

	        prevIteration = _animationCycle(this._tTime, cycleDuration);

	        if (time === prevTime && !force && this._initted) {
	          //could be during the repeatDelay part. No need to render and fire callbacks.
	          return this;
	        }

	        if (iteration !== prevIteration) {
	          timeline && this._yEase && _propagateYoyoEase(timeline, isYoyo); //repeatRefresh functionality

	          if (this.vars.repeatRefresh && !isYoyo && !this._lock) {
	            this._lock = force = 1; //force, otherwise if lazy is true, the _attemptInitTween() will return and we'll jump out and get caught bouncing on each tick.

	            this.render(_roundPrecise(cycleDuration * iteration), true).invalidate()._lock = 0;
	          }
	        }
	      }

	      if (!this._initted) {
	        if (_attemptInitTween(this, totalTime < 0 ? totalTime : time, force, suppressEvents)) {
	          this._tTime = 0; // in constructor if immediateRender is true, we set _tTime to -_tinyNum to have the playhead cross the starting point but we can't leave _tTime as a negative number.

	          return this;
	        }

	        if (dur !== this._dur) {
	          // while initting, a plugin like InertiaPlugin might alter the duration, so rerun from the start to ensure everything renders as it should.
	          return this.render(totalTime, suppressEvents, force);
	        }
	      }

	      this._tTime = tTime;
	      this._time = time;

	      if (!this._act && this._ts) {
	        this._act = 1; //as long as it's not paused, force it to be active so that if the user renders independent of the parent timeline, it'll be forced to re-render on the next tick.

	        this._lazy = 0;
	      }

	      this.ratio = ratio = (yoyoEase || this._ease)(time / dur);

	      if (this._from) {
	        this.ratio = ratio = 1 - ratio;
	      }

	      if (time && !prevTime && !suppressEvents) {
	        _callback(this, "onStart");

	        if (this._tTime !== tTime) {
	          // in case the onStart triggered a render at a different spot, eject. Like if someone did animation.pause(0.5) or something inside the onStart.
	          return this;
	        }
	      }

	      pt = this._pt;

	      while (pt) {
	        pt.r(ratio, pt.d);
	        pt = pt._next;
	      }

	      timeline && timeline.render(totalTime < 0 ? totalTime : !time && isYoyo ? -_tinyNum : timeline._dur * ratio, suppressEvents, force) || this._startAt && (this._zTime = totalTime);

	      if (this._onUpdate && !suppressEvents) {
	        totalTime < 0 && this._startAt && this._startAt.render(totalTime, true, force); //note: for performance reasons, we tuck this conditional logic inside less traveled areas (most tweens don't have an onUpdate). We'd just have it at the end before the onComplete, but the values should be updated before any onUpdate is called, so we ALSO put it here and then if it's not called, we do so later near the onComplete.

	        _callback(this, "onUpdate");
	      }

	      this._repeat && iteration !== prevIteration && this.vars.onRepeat && !suppressEvents && this.parent && _callback(this, "onRepeat");

	      if ((tTime === this._tDur || !tTime) && this._tTime === tTime) {
	        totalTime < 0 && this._startAt && !this._onUpdate && this._startAt.render(totalTime, true, true);
	        (totalTime || !dur) && (tTime === this._tDur && this._ts > 0 || !tTime && this._ts < 0) && _removeFromParent(this, 1); // don't remove if we're rendering at exactly a time of 0, as there could be autoRevert values that should get set on the next tick (if the playhead goes backward beyond the startTime, negative totalTime). Don't remove if the timeline is reversed and the playhead isn't at 0, otherwise tl.progress(1).reverse() won't work. Only remove if the playhead is at the end and timeScale is positive, or if the playhead is at 0 and the timeScale is negative.

	        if (!suppressEvents && !(totalTime < 0 && !prevTime) && (tTime || prevTime)) {
	          // if prevTime and tTime are zero, we shouldn't fire the onReverseComplete. This could happen if you gsap.to(... {paused:true}).play();
	          _callback(this, tTime === tDur ? "onComplete" : "onReverseComplete", true);

	          this._prom && !(tTime < tDur && this.timeScale() > 0) && this._prom();
	        }
	      }
	    }

	    return this;
	  };

	  _proto3.targets = function targets() {
	    return this._targets;
	  };

	  _proto3.invalidate = function invalidate() {
	    this._pt = this._op = this._startAt = this._onUpdate = this._lazy = this.ratio = 0;
	    this._ptLookup = [];
	    this.timeline && this.timeline.invalidate();
	    return _Animation2.prototype.invalidate.call(this);
	  };

	  _proto3.kill = function kill(targets, vars) {
	    if (vars === void 0) {
	      vars = "all";
	    }

	    if (!targets && (!vars || vars === "all")) {
	      this._lazy = this._pt = 0;
	      return this.parent ? _interrupt(this) : this;
	    }

	    if (this.timeline) {
	      var tDur = this.timeline.totalDuration();
	      this.timeline.killTweensOf(targets, vars, _overwritingTween && _overwritingTween.vars.overwrite !== true)._first || _interrupt(this); // if nothing is left tweening, interrupt.

	      this.parent && tDur !== this.timeline.totalDuration() && _setDuration(this, this._dur * this.timeline._tDur / tDur, 0, 1); // if a nested tween is killed that changes the duration, it should affect this tween's duration. We must use the ratio, though, because sometimes the internal timeline is stretched like for keyframes where they don't all add up to whatever the parent tween's duration was set to.

	      return this;
	    }

	    var parsedTargets = this._targets,
	        killingTargets = targets ? toArray(targets) : parsedTargets,
	        propTweenLookup = this._ptLookup,
	        firstPT = this._pt,
	        overwrittenProps,
	        curLookup,
	        curOverwriteProps,
	        props,
	        p,
	        pt,
	        i;

	    if ((!vars || vars === "all") && _arraysMatch(parsedTargets, killingTargets)) {
	      vars === "all" && (this._pt = 0);
	      return _interrupt(this);
	    }

	    overwrittenProps = this._op = this._op || [];

	    if (vars !== "all") {
	      //so people can pass in a comma-delimited list of property names
	      if (_isString(vars)) {
	        p = {};

	        _forEachName(vars, function (name) {
	          return p[name] = 1;
	        });

	        vars = p;
	      }

	      vars = _addAliasesToVars(parsedTargets, vars);
	    }

	    i = parsedTargets.length;

	    while (i--) {
	      if (~killingTargets.indexOf(parsedTargets[i])) {
	        curLookup = propTweenLookup[i];

	        if (vars === "all") {
	          overwrittenProps[i] = vars;
	          props = curLookup;
	          curOverwriteProps = {};
	        } else {
	          curOverwriteProps = overwrittenProps[i] = overwrittenProps[i] || {};
	          props = vars;
	        }

	        for (p in props) {
	          pt = curLookup && curLookup[p];

	          if (pt) {
	            if (!("kill" in pt.d) || pt.d.kill(p) === true) {
	              _removeLinkedListItem(this, pt, "_pt");
	            }

	            delete curLookup[p];
	          }

	          if (curOverwriteProps !== "all") {
	            curOverwriteProps[p] = 1;
	          }
	        }
	      }
	    }

	    this._initted && !this._pt && firstPT && _interrupt(this); //if all tweening properties are killed, kill the tween. Without this line, if there's a tween with multiple targets and then you killTweensOf() each target individually, the tween would technically still remain active and fire its onComplete even though there aren't any more properties tweening.

	    return this;
	  };

	  Tween.to = function to(targets, vars) {
	    return new Tween(targets, vars, arguments[2]);
	  };

	  Tween.from = function from(targets, vars) {
	    return _createTweenType(1, arguments);
	  };

	  Tween.delayedCall = function delayedCall(delay, callback, params, scope) {
	    return new Tween(callback, 0, {
	      immediateRender: false,
	      lazy: false,
	      overwrite: false,
	      delay: delay,
	      onComplete: callback,
	      onReverseComplete: callback,
	      onCompleteParams: params,
	      onReverseCompleteParams: params,
	      callbackScope: scope
	    });
	  };

	  Tween.fromTo = function fromTo(targets, fromVars, toVars) {
	    return _createTweenType(2, arguments);
	  };

	  Tween.set = function set(targets, vars) {
	    vars.duration = 0;
	    vars.repeatDelay || (vars.repeat = 0);
	    return new Tween(targets, vars);
	  };

	  Tween.killTweensOf = function killTweensOf(targets, props, onlyActive) {
	    return _globalTimeline.killTweensOf(targets, props, onlyActive);
	  };

	  return Tween;
	}(Animation);

	_setDefaults(Tween.prototype, {
	  _targets: [],
	  _lazy: 0,
	  _startAt: 0,
	  _op: 0,
	  _onInit: 0
	}); //add the pertinent timeline methods to Tween instances so that users can chain conveniently and create a timeline automatically. (removed due to concerns that it'd ultimately add to more confusion especially for beginners)
	// _forEachName("to,from,fromTo,set,call,add,addLabel,addPause", name => {
	// 	Tween.prototype[name] = function() {
	// 		let tl = new Timeline();
	// 		return _addToTimeline(tl, this)[name].apply(tl, toArray(arguments));
	// 	}
	// });
	//for backward compatibility. Leverage the timeline calls.


	_forEachName("staggerTo,staggerFrom,staggerFromTo", function (name) {
	  Tween[name] = function () {
	    var tl = new Timeline(),
	        params = _slice.call(arguments, 0);

	    params.splice(name === "staggerFromTo" ? 5 : 4, 0, 0);
	    return tl[name].apply(tl, params);
	  };
	});
	/*
	 * --------------------------------------------------------------------------------------
	 * PROPTWEEN
	 * --------------------------------------------------------------------------------------
	 */


	var _setterPlain = function _setterPlain(target, property, value) {
	  return target[property] = value;
	},
	    _setterFunc = function _setterFunc(target, property, value) {
	  return target[property](value);
	},
	    _setterFuncWithParam = function _setterFuncWithParam(target, property, value, data) {
	  return target[property](data.fp, value);
	},
	    _setterAttribute = function _setterAttribute(target, property, value) {
	  return target.setAttribute(property, value);
	},
	    _getSetter = function _getSetter(target, property) {
	  return _isFunction(target[property]) ? _setterFunc : _isUndefined(target[property]) && target.setAttribute ? _setterAttribute : _setterPlain;
	},
	    _renderPlain = function _renderPlain(ratio, data) {
	  return data.set(data.t, data.p, Math.round((data.s + data.c * ratio) * 1000000) / 1000000, data);
	},
	    _renderBoolean = function _renderBoolean(ratio, data) {
	  return data.set(data.t, data.p, !!(data.s + data.c * ratio), data);
	},
	    _renderComplexString = function _renderComplexString(ratio, data) {
	  var pt = data._pt,
	      s = "";

	  if (!ratio && data.b) {
	    //b = beginning string
	    s = data.b;
	  } else if (ratio === 1 && data.e) {
	    //e = ending string
	    s = data.e;
	  } else {
	    while (pt) {
	      s = pt.p + (pt.m ? pt.m(pt.s + pt.c * ratio) : Math.round((pt.s + pt.c * ratio) * 10000) / 10000) + s; //we use the "p" property for the text inbetween (like a suffix). And in the context of a complex string, the modifier (m) is typically just Math.round(), like for RGB colors.

	      pt = pt._next;
	    }

	    s += data.c; //we use the "c" of the PropTween to store the final chunk of non-numeric text.
	  }

	  data.set(data.t, data.p, s, data);
	},
	    _renderPropTweens = function _renderPropTweens(ratio, data) {
	  var pt = data._pt;

	  while (pt) {
	    pt.r(ratio, pt.d);
	    pt = pt._next;
	  }
	},
	    _addPluginModifier = function _addPluginModifier(modifier, tween, target, property) {
	  var pt = this._pt,
	      next;

	  while (pt) {
	    next = pt._next;
	    pt.p === property && pt.modifier(modifier, tween, target);
	    pt = next;
	  }
	},
	    _killPropTweensOf = function _killPropTweensOf(property) {
	  var pt = this._pt,
	      hasNonDependentRemaining,
	      next;

	  while (pt) {
	    next = pt._next;

	    if (pt.p === property && !pt.op || pt.op === property) {
	      _removeLinkedListItem(this, pt, "_pt");
	    } else if (!pt.dep) {
	      hasNonDependentRemaining = 1;
	    }

	    pt = next;
	  }

	  return !hasNonDependentRemaining;
	},
	    _setterWithModifier = function _setterWithModifier(target, property, value, data) {
	  data.mSet(target, property, data.m.call(data.tween, value, data.mt), data);
	},
	    _sortPropTweensByPriority = function _sortPropTweensByPriority(parent) {
	  var pt = parent._pt,
	      next,
	      pt2,
	      first,
	      last; //sorts the PropTween linked list in order of priority because some plugins need to do their work after ALL of the PropTweens were created (like RoundPropsPlugin and ModifiersPlugin)

	  while (pt) {
	    next = pt._next;
	    pt2 = first;

	    while (pt2 && pt2.pr > pt.pr) {
	      pt2 = pt2._next;
	    }

	    if (pt._prev = pt2 ? pt2._prev : last) {
	      pt._prev._next = pt;
	    } else {
	      first = pt;
	    }

	    if (pt._next = pt2) {
	      pt2._prev = pt;
	    } else {
	      last = pt;
	    }

	    pt = next;
	  }

	  parent._pt = first;
	}; //PropTween key: t = target, p = prop, r = renderer, d = data, s = start, c = change, op = overwriteProperty (ONLY populated when it's different than p), pr = priority, _next/_prev for the linked list siblings, set = setter, m = modifier, mSet = modifierSetter (the original setter, before a modifier was added)


	var PropTween = /*#__PURE__*/function () {
	  function PropTween(next, target, prop, start, change, renderer, data, setter, priority) {
	    this.t = target;
	    this.s = start;
	    this.c = change;
	    this.p = prop;
	    this.r = renderer || _renderPlain;
	    this.d = data || this;
	    this.set = setter || _setterPlain;
	    this.pr = priority || 0;
	    this._next = next;

	    if (next) {
	      next._prev = this;
	    }
	  }

	  var _proto4 = PropTween.prototype;

	  _proto4.modifier = function modifier(func, tween, target) {
	    this.mSet = this.mSet || this.set; //in case it was already set (a PropTween can only have one modifier)

	    this.set = _setterWithModifier;
	    this.m = func;
	    this.mt = target; //modifier target

	    this.tween = tween;
	  };

	  return PropTween;
	}(); //Initialization tasks

	_forEachName(_callbackNames + "parent,duration,ease,delay,overwrite,runBackwards,startAt,yoyo,immediateRender,repeat,repeatDelay,data,paused,reversed,lazy,callbackScope,stringFilter,id,yoyoEase,stagger,inherit,repeatRefresh,keyframes,autoRevert,scrollTrigger", function (name) {
	  return _reservedProps[name] = 1;
	});

	_globals.TweenMax = _globals.TweenLite = Tween;
	_globals.TimelineLite = _globals.TimelineMax = Timeline;
	_globalTimeline = new Timeline({
	  sortChildren: false,
	  defaults: _defaults,
	  autoRemoveChildren: true,
	  id: "root",
	  smoothChildTiming: true
	});
	_config.stringFilter = _colorStringFilter;
	/*
	 * --------------------------------------------------------------------------------------
	 * GSAP
	 * --------------------------------------------------------------------------------------
	 */

	var _gsap = {
	  registerPlugin: function registerPlugin() {
	    for (var _len2 = arguments.length, args = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
	      args[_key2] = arguments[_key2];
	    }

	    args.forEach(function (config) {
	      return _createPlugin(config);
	    });
	  },
	  timeline: function timeline(vars) {
	    return new Timeline(vars);
	  },
	  getTweensOf: function getTweensOf(targets, onlyActive) {
	    return _globalTimeline.getTweensOf(targets, onlyActive);
	  },
	  getProperty: function getProperty(target, property, unit, uncache) {
	    _isString(target) && (target = toArray(target)[0]); //in case selector text or an array is passed in

	    var getter = _getCache(target || {}).get,
	        format = unit ? _passThrough : _numericIfPossible;

	    unit === "native" && (unit = "");
	    return !target ? target : !property ? function (property, unit, uncache) {
	      return format((_plugins[property] && _plugins[property].get || getter)(target, property, unit, uncache));
	    } : format((_plugins[property] && _plugins[property].get || getter)(target, property, unit, uncache));
	  },
	  quickSetter: function quickSetter(target, property, unit) {
	    target = toArray(target);

	    if (target.length > 1) {
	      var setters = target.map(function (t) {
	        return gsap.quickSetter(t, property, unit);
	      }),
	          l = setters.length;
	      return function (value) {
	        var i = l;

	        while (i--) {
	          setters[i](value);
	        }
	      };
	    }

	    target = target[0] || {};

	    var Plugin = _plugins[property],
	        cache = _getCache(target),
	        p = cache.harness && (cache.harness.aliases || {})[property] || property,
	        // in case it's an alias, like "rotate" for "rotation".
	    setter = Plugin ? function (value) {
	      var p = new Plugin();
	      _quickTween._pt = 0;
	      p.init(target, unit ? value + unit : value, _quickTween, 0, [target]);
	      p.render(1, p);
	      _quickTween._pt && _renderPropTweens(1, _quickTween);
	    } : cache.set(target, p);

	    return Plugin ? setter : function (value) {
	      return setter(target, p, unit ? value + unit : value, cache, 1);
	    };
	  },
	  isTweening: function isTweening(targets) {
	    return _globalTimeline.getTweensOf(targets, true).length > 0;
	  },
	  defaults: function defaults(value) {
	    value && value.ease && (value.ease = _parseEase(value.ease, _defaults.ease));
	    return _mergeDeep(_defaults, value || {});
	  },
	  config: function config(value) {
	    return _mergeDeep(_config, value || {});
	  },
	  registerEffect: function registerEffect(_ref3) {
	    var name = _ref3.name,
	        effect = _ref3.effect,
	        plugins = _ref3.plugins,
	        defaults = _ref3.defaults,
	        extendTimeline = _ref3.extendTimeline;
	    (plugins || "").split(",").forEach(function (pluginName) {
	      return pluginName && !_plugins[pluginName] && !_globals[pluginName] && _warn(name + " effect requires " + pluginName + " plugin.");
	    });

	    _effects[name] = function (targets, vars, tl) {
	      return effect(toArray(targets), _setDefaults(vars || {}, defaults), tl);
	    };

	    if (extendTimeline) {
	      Timeline.prototype[name] = function (targets, vars, position) {
	        return this.add(_effects[name](targets, _isObject(vars) ? vars : (position = vars) && {}, this), position);
	      };
	    }
	  },
	  registerEase: function registerEase(name, ease) {
	    _easeMap[name] = _parseEase(ease);
	  },
	  parseEase: function parseEase(ease, defaultEase) {
	    return arguments.length ? _parseEase(ease, defaultEase) : _easeMap;
	  },
	  getById: function getById(id) {
	    return _globalTimeline.getById(id);
	  },
	  exportRoot: function exportRoot(vars, includeDelayedCalls) {
	    if (vars === void 0) {
	      vars = {};
	    }

	    var tl = new Timeline(vars),
	        child,
	        next;
	    tl.smoothChildTiming = _isNotFalse(vars.smoothChildTiming);

	    _globalTimeline.remove(tl);

	    tl._dp = 0; //otherwise it'll get re-activated when adding children and be re-introduced into _globalTimeline's linked list (then added to itself).

	    tl._time = tl._tTime = _globalTimeline._time;
	    child = _globalTimeline._first;

	    while (child) {
	      next = child._next;

	      if (includeDelayedCalls || !(!child._dur && child instanceof Tween && child.vars.onComplete === child._targets[0])) {
	        _addToTimeline(tl, child, child._start - child._delay);
	      }

	      child = next;
	    }

	    _addToTimeline(_globalTimeline, tl, 0);

	    return tl;
	  },
	  utils: {
	    wrap: wrap,
	    wrapYoyo: wrapYoyo,
	    distribute: distribute,
	    random: random,
	    snap: snap,
	    normalize: normalize,
	    getUnit: getUnit,
	    clamp: clamp,
	    splitColor: splitColor,
	    toArray: toArray,
	    selector: selector,
	    mapRange: mapRange,
	    pipe: pipe,
	    unitize: unitize,
	    interpolate: interpolate,
	    shuffle: shuffle
	  },
	  install: _install,
	  effects: _effects,
	  ticker: _ticker,
	  updateRoot: Timeline.updateRoot,
	  plugins: _plugins,
	  globalTimeline: _globalTimeline,
	  core: {
	    PropTween: PropTween,
	    globals: _addGlobal,
	    Tween: Tween,
	    Timeline: Timeline,
	    Animation: Animation,
	    getCache: _getCache,
	    _removeLinkedListItem: _removeLinkedListItem,
	    suppressOverwrites: function suppressOverwrites(value) {
	      return _suppressOverwrites = value;
	    }
	  }
	};

	_forEachName("to,from,fromTo,delayedCall,set,killTweensOf", function (name) {
	  return _gsap[name] = Tween[name];
	});

	_ticker.add(Timeline.updateRoot);

	_quickTween = _gsap.to({}, {
	  duration: 0
	}); // ---- EXTRA PLUGINS --------------------------------------------------------

	var _getPluginPropTween = function _getPluginPropTween(plugin, prop) {
	  var pt = plugin._pt;

	  while (pt && pt.p !== prop && pt.op !== prop && pt.fp !== prop) {
	    pt = pt._next;
	  }

	  return pt;
	},
	    _addModifiers = function _addModifiers(tween, modifiers) {
	  var targets = tween._targets,
	      p,
	      i,
	      pt;

	  for (p in modifiers) {
	    i = targets.length;

	    while (i--) {
	      pt = tween._ptLookup[i][p];

	      if (pt && (pt = pt.d)) {
	        if (pt._pt) {
	          // is a plugin
	          pt = _getPluginPropTween(pt, p);
	        }

	        pt && pt.modifier && pt.modifier(modifiers[p], tween, targets[i], p);
	      }
	    }
	  }
	},
	    _buildModifierPlugin = function _buildModifierPlugin(name, modifier) {
	  return {
	    name: name,
	    rawVars: 1,
	    //don't pre-process function-based values or "random()" strings.
	    init: function init(target, vars, tween) {
	      tween._onInit = function (tween) {
	        var temp, p;

	        if (_isString(vars)) {
	          temp = {};

	          _forEachName(vars, function (name) {
	            return temp[name] = 1;
	          }); //if the user passes in a comma-delimited list of property names to roundProps, like "x,y", we round to whole numbers.


	          vars = temp;
	        }

	        if (modifier) {
	          temp = {};

	          for (p in vars) {
	            temp[p] = modifier(vars[p]);
	          }

	          vars = temp;
	        }

	        _addModifiers(tween, vars);
	      };
	    }
	  };
	}; //register core plugins


	var gsap = _gsap.registerPlugin({
	  name: "attr",
	  init: function init(target, vars, tween, index, targets) {
	    var p, pt;

	    for (p in vars) {
	      pt = this.add(target, "setAttribute", (target.getAttribute(p) || 0) + "", vars[p], index, targets, 0, 0, p);
	      pt && (pt.op = p);

	      this._props.push(p);
	    }
	  }
	}, {
	  name: "endArray",
	  init: function init(target, value) {
	    var i = value.length;

	    while (i--) {
	      this.add(target, i, target[i] || 0, value[i]);
	    }
	  }
	}, _buildModifierPlugin("roundProps", _roundModifier), _buildModifierPlugin("modifiers"), _buildModifierPlugin("snap", snap)) || _gsap; //to prevent the core plugins from being dropped via aggressive tree shaking, we must include them in the variable declaration in this way.

	Tween.version = Timeline.version = gsap.version = "3.8.0";
	_coreReady = 1;
	_windowExists$1() && _wake();
	_easeMap.Power0;
	    _easeMap.Power1;
	    _easeMap.Power2;
	    _easeMap.Power3;
	    _easeMap.Power4;
	    _easeMap.Linear;
	    _easeMap.Quad;
	    _easeMap.Cubic;
	    _easeMap.Quart;
	    _easeMap.Quint;
	    _easeMap.Strong;
	    _easeMap.Elastic;
	    _easeMap.Back;
	    _easeMap.SteppedEase;
	    _easeMap.Bounce;
	    _easeMap.Sine;
	    _easeMap.Expo;
	    _easeMap.Circ;

	/*!
	 * CSSPlugin 3.8.0
	 * https://greensock.com
	 *
	 * Copyright 2008-2021, GreenSock. All rights reserved.
	 * Subject to the terms at https://greensock.com/standard-license or for
	 * Club GreenSock members, the agreement issued with that membership.
	 * @author: Jack Doyle, jack@greensock.com
	*/

	var _win,
	    _doc,
	    _docElement,
	    _pluginInitted,
	    _tempDiv,
	    _recentSetterPlugin,
	    _windowExists = function _windowExists() {
	  return typeof window !== "undefined";
	},
	    _transformProps = {},
	    _RAD2DEG = 180 / Math.PI,
	    _DEG2RAD = Math.PI / 180,
	    _atan2 = Math.atan2,
	    _bigNum = 1e8,
	    _capsExp = /([A-Z])/g,
	    _horizontalExp = /(?:left|right|width|margin|padding|x)/i,
	    _complexExp = /[\s,\(]\S/,
	    _propertyAliases = {
	  autoAlpha: "opacity,visibility",
	  scale: "scaleX,scaleY",
	  alpha: "opacity"
	},
	    _renderCSSProp = function _renderCSSProp(ratio, data) {
	  return data.set(data.t, data.p, Math.round((data.s + data.c * ratio) * 10000) / 10000 + data.u, data);
	},
	    _renderPropWithEnd = function _renderPropWithEnd(ratio, data) {
	  return data.set(data.t, data.p, ratio === 1 ? data.e : Math.round((data.s + data.c * ratio) * 10000) / 10000 + data.u, data);
	},
	    _renderCSSPropWithBeginning = function _renderCSSPropWithBeginning(ratio, data) {
	  return data.set(data.t, data.p, ratio ? Math.round((data.s + data.c * ratio) * 10000) / 10000 + data.u : data.b, data);
	},
	    //if units change, we need a way to render the original unit/value when the tween goes all the way back to the beginning (ratio:0)
	_renderRoundedCSSProp = function _renderRoundedCSSProp(ratio, data) {
	  var value = data.s + data.c * ratio;
	  data.set(data.t, data.p, ~~(value + (value < 0 ? -.5 : .5)) + data.u, data);
	},
	    _renderNonTweeningValue = function _renderNonTweeningValue(ratio, data) {
	  return data.set(data.t, data.p, ratio ? data.e : data.b, data);
	},
	    _renderNonTweeningValueOnlyAtEnd = function _renderNonTweeningValueOnlyAtEnd(ratio, data) {
	  return data.set(data.t, data.p, ratio !== 1 ? data.b : data.e, data);
	},
	    _setterCSSStyle = function _setterCSSStyle(target, property, value) {
	  return target.style[property] = value;
	},
	    _setterCSSProp = function _setterCSSProp(target, property, value) {
	  return target.style.setProperty(property, value);
	},
	    _setterTransform = function _setterTransform(target, property, value) {
	  return target._gsap[property] = value;
	},
	    _setterScale = function _setterScale(target, property, value) {
	  return target._gsap.scaleX = target._gsap.scaleY = value;
	},
	    _setterScaleWithRender = function _setterScaleWithRender(target, property, value, data, ratio) {
	  var cache = target._gsap;
	  cache.scaleX = cache.scaleY = value;
	  cache.renderTransform(ratio, cache);
	},
	    _setterTransformWithRender = function _setterTransformWithRender(target, property, value, data, ratio) {
	  var cache = target._gsap;
	  cache[property] = value;
	  cache.renderTransform(ratio, cache);
	},
	    _transformProp = "transform",
	    _transformOriginProp = _transformProp + "Origin",
	    _supports3D,
	    _createElement = function _createElement(type, ns) {
	  var e = _doc.createElementNS ? _doc.createElementNS((ns || "http://www.w3.org/1999/xhtml").replace(/^https/, "http"), type) : _doc.createElement(type); //some servers swap in https for http in the namespace which can break things, making "style" inaccessible.

	  return e.style ? e : _doc.createElement(type); //some environments won't allow access to the element's style when created with a namespace in which case we default to the standard createElement() to work around the issue. Also note that when GSAP is embedded directly inside an SVG file, createElement() won't allow access to the style object in Firefox (see https://greensock.com/forums/topic/20215-problem-using-tweenmax-in-standalone-self-containing-svg-file-err-cannot-set-property-csstext-of-undefined/).
	},
	    _getComputedProperty = function _getComputedProperty(target, property, skipPrefixFallback) {
	  var cs = getComputedStyle(target);
	  return cs[property] || cs.getPropertyValue(property.replace(_capsExp, "-$1").toLowerCase()) || cs.getPropertyValue(property) || !skipPrefixFallback && _getComputedProperty(target, _checkPropPrefix(property) || property, 1) || ""; //css variables may not need caps swapped out for dashes and lowercase.
	},
	    _prefixes = "O,Moz,ms,Ms,Webkit".split(","),
	    _checkPropPrefix = function _checkPropPrefix(property, element, preferPrefix) {
	  var e = element || _tempDiv,
	      s = e.style,
	      i = 5;

	  if (property in s && !preferPrefix) {
	    return property;
	  }

	  property = property.charAt(0).toUpperCase() + property.substr(1);

	  while (i-- && !(_prefixes[i] + property in s)) {}

	  return i < 0 ? null : (i === 3 ? "ms" : i >= 0 ? _prefixes[i] : "") + property;
	},
	    _initCore = function _initCore() {
	  if (_windowExists() && window.document) {
	    _win = window;
	    _doc = _win.document;
	    _docElement = _doc.documentElement;
	    _tempDiv = _createElement("div") || {
	      style: {}
	    };
	    _createElement("div");
	    _transformProp = _checkPropPrefix(_transformProp);
	    _transformOriginProp = _transformProp + "Origin";
	    _tempDiv.style.cssText = "border-width:0;line-height:0;position:absolute;padding:0"; //make sure to override certain properties that may contaminate measurements, in case the user has overreaching style sheets.

	    _supports3D = !!_checkPropPrefix("perspective");
	    _pluginInitted = 1;
	  }
	},
	    _getBBoxHack = function _getBBoxHack(swapIfPossible) {
	  //works around issues in some browsers (like Firefox) that don't correctly report getBBox() on SVG elements inside a <defs> element and/or <mask>. We try creating an SVG, adding it to the documentElement and toss the element in there so that it's definitely part of the rendering tree, then grab the bbox and if it works, we actually swap out the original getBBox() method for our own that does these extra steps whenever getBBox is needed. This helps ensure that performance is optimal (only do all these extra steps when absolutely necessary...most elements don't need it).
	  var svg = _createElement("svg", this.ownerSVGElement && this.ownerSVGElement.getAttribute("xmlns") || "http://www.w3.org/2000/svg"),
	      oldParent = this.parentNode,
	      oldSibling = this.nextSibling,
	      oldCSS = this.style.cssText,
	      bbox;

	  _docElement.appendChild(svg);

	  svg.appendChild(this);
	  this.style.display = "block";

	  if (swapIfPossible) {
	    try {
	      bbox = this.getBBox();
	      this._gsapBBox = this.getBBox; //store the original

	      this.getBBox = _getBBoxHack;
	    } catch (e) {}
	  } else if (this._gsapBBox) {
	    bbox = this._gsapBBox();
	  }

	  if (oldParent) {
	    if (oldSibling) {
	      oldParent.insertBefore(this, oldSibling);
	    } else {
	      oldParent.appendChild(this);
	    }
	  }

	  _docElement.removeChild(svg);

	  this.style.cssText = oldCSS;
	  return bbox;
	},
	    _getAttributeFallbacks = function _getAttributeFallbacks(target, attributesArray) {
	  var i = attributesArray.length;

	  while (i--) {
	    if (target.hasAttribute(attributesArray[i])) {
	      return target.getAttribute(attributesArray[i]);
	    }
	  }
	},
	    _getBBox = function _getBBox(target) {
	  var bounds;

	  try {
	    bounds = target.getBBox(); //Firefox throws errors if you try calling getBBox() on an SVG element that's not rendered (like in a <symbol> or <defs>). https://bugzilla.mozilla.org/show_bug.cgi?id=612118
	  } catch (error) {
	    bounds = _getBBoxHack.call(target, true);
	  }

	  bounds && (bounds.width || bounds.height) || target.getBBox === _getBBoxHack || (bounds = _getBBoxHack.call(target, true)); //some browsers (like Firefox) misreport the bounds if the element has zero width and height (it just assumes it's at x:0, y:0), thus we need to manually grab the position in that case.

	  return bounds && !bounds.width && !bounds.x && !bounds.y ? {
	    x: +_getAttributeFallbacks(target, ["x", "cx", "x1"]) || 0,
	    y: +_getAttributeFallbacks(target, ["y", "cy", "y1"]) || 0,
	    width: 0,
	    height: 0
	  } : bounds;
	},
	    _isSVG = function _isSVG(e) {
	  return !!(e.getCTM && (!e.parentNode || e.ownerSVGElement) && _getBBox(e));
	},
	    //reports if the element is an SVG on which getBBox() actually works
	_removeProperty = function _removeProperty(target, property) {
	  if (property) {
	    var style = target.style;

	    if (property in _transformProps && property !== _transformOriginProp) {
	      property = _transformProp;
	    }

	    if (style.removeProperty) {
	      if (property.substr(0, 2) === "ms" || property.substr(0, 6) === "webkit") {
	        //Microsoft and some Webkit browsers don't conform to the standard of capitalizing the first prefix character, so we adjust so that when we prefix the caps with a dash, it's correct (otherwise it'd be "ms-transform" instead of "-ms-transform" for IE9, for example)
	        property = "-" + property;
	      }

	      style.removeProperty(property.replace(_capsExp, "-$1").toLowerCase());
	    } else {
	      //note: old versions of IE use "removeAttribute()" instead of "removeProperty()"
	      style.removeAttribute(property);
	    }
	  }
	},
	    _addNonTweeningPT = function _addNonTweeningPT(plugin, target, property, beginning, end, onlySetAtEnd) {
	  var pt = new PropTween(plugin._pt, target, property, 0, 1, onlySetAtEnd ? _renderNonTweeningValueOnlyAtEnd : _renderNonTweeningValue);
	  plugin._pt = pt;
	  pt.b = beginning;
	  pt.e = end;

	  plugin._props.push(property);

	  return pt;
	},
	    _nonConvertibleUnits = {
	  deg: 1,
	  rad: 1,
	  turn: 1
	},
	    //takes a single value like 20px and converts it to the unit specified, like "%", returning only the numeric amount.
	_convertToUnit = function _convertToUnit(target, property, value, unit) {
	  var curValue = parseFloat(value) || 0,
	      curUnit = (value + "").trim().substr((curValue + "").length) || "px",
	      // some browsers leave extra whitespace at the beginning of CSS variables, hence the need to trim()
	  style = _tempDiv.style,
	      horizontal = _horizontalExp.test(property),
	      isRootSVG = target.tagName.toLowerCase() === "svg",
	      measureProperty = (isRootSVG ? "client" : "offset") + (horizontal ? "Width" : "Height"),
	      amount = 100,
	      toPixels = unit === "px",
	      toPercent = unit === "%",
	      px,
	      parent,
	      cache,
	      isSVG;

	  if (unit === curUnit || !curValue || _nonConvertibleUnits[unit] || _nonConvertibleUnits[curUnit]) {
	    return curValue;
	  }

	  curUnit !== "px" && !toPixels && (curValue = _convertToUnit(target, property, value, "px"));
	  isSVG = target.getCTM && _isSVG(target);

	  if ((toPercent || curUnit === "%") && (_transformProps[property] || ~property.indexOf("adius"))) {
	    px = isSVG ? target.getBBox()[horizontal ? "width" : "height"] : target[measureProperty];
	    return _round(toPercent ? curValue / px * amount : curValue / 100 * px);
	  }

	  style[horizontal ? "width" : "height"] = amount + (toPixels ? curUnit : unit);
	  parent = ~property.indexOf("adius") || unit === "em" && target.appendChild && !isRootSVG ? target : target.parentNode;

	  if (isSVG) {
	    parent = (target.ownerSVGElement || {}).parentNode;
	  }

	  if (!parent || parent === _doc || !parent.appendChild) {
	    parent = _doc.body;
	  }

	  cache = parent._gsap;

	  if (cache && toPercent && cache.width && horizontal && cache.time === _ticker.time) {
	    return _round(curValue / cache.width * amount);
	  } else {
	    (toPercent || curUnit === "%") && (style.position = _getComputedProperty(target, "position"));
	    parent === target && (style.position = "static"); // like for borderRadius, if it's a % we must have it relative to the target itself but that may not have position: relative or position: absolute in which case it'd go up the chain until it finds its offsetParent (bad). position: static protects against that.

	    parent.appendChild(_tempDiv);
	    px = _tempDiv[measureProperty];
	    parent.removeChild(_tempDiv);
	    style.position = "absolute";

	    if (horizontal && toPercent) {
	      cache = _getCache(parent);
	      cache.time = _ticker.time;
	      cache.width = parent[measureProperty];
	    }
	  }

	  return _round(toPixels ? px * curValue / amount : px && curValue ? amount / px * curValue : 0);
	},
	    _get = function _get(target, property, unit, uncache) {
	  var value;
	  _pluginInitted || _initCore();

	  if (property in _propertyAliases && property !== "transform") {
	    property = _propertyAliases[property];

	    if (~property.indexOf(",")) {
	      property = property.split(",")[0];
	    }
	  }

	  if (_transformProps[property] && property !== "transform") {
	    value = _parseTransform(target, uncache);
	    value = property !== "transformOrigin" ? value[property] : value.svg ? value.origin : _firstTwoOnly(_getComputedProperty(target, _transformOriginProp)) + " " + value.zOrigin + "px";
	  } else {
	    value = target.style[property];

	    if (!value || value === "auto" || uncache || ~(value + "").indexOf("calc(")) {
	      value = _specialProps[property] && _specialProps[property](target, property, unit) || _getComputedProperty(target, property) || _getProperty(target, property) || (property === "opacity" ? 1 : 0); // note: some browsers, like Firefox, don't report borderRadius correctly! Instead, it only reports every corner like  borderTopLeftRadius
	    }
	  }

	  return unit && !~(value + "").trim().indexOf(" ") ? _convertToUnit(target, property, value, unit) + unit : value;
	},
	    _tweenComplexCSSString = function _tweenComplexCSSString(target, prop, start, end) {
	  //note: we call _tweenComplexCSSString.call(pluginInstance...) to ensure that it's scoped properly. We may call it from within a plugin too, thus "this" would refer to the plugin.
	  if (!start || start === "none") {
	    // some browsers like Safari actually PREFER the prefixed property and mis-report the unprefixed value like clipPath (BUG). In other words, even though clipPath exists in the style ("clipPath" in target.style) and it's set in the CSS properly (along with -webkit-clip-path), Safari reports clipPath as "none" whereas WebkitClipPath reports accurately like "ellipse(100% 0% at 50% 0%)", so in this case we must SWITCH to using the prefixed property instead. See https://greensock.com/forums/topic/18310-clippath-doesnt-work-on-ios/
	    var p = _checkPropPrefix(prop, target, 1),
	        s = p && _getComputedProperty(target, p, 1);

	    if (s && s !== start) {
	      prop = p;
	      start = s;
	    } else if (prop === "borderColor") {
	      start = _getComputedProperty(target, "borderTopColor"); // Firefox bug: always reports "borderColor" as "", so we must fall back to borderTopColor. See https://greensock.com/forums/topic/24583-how-to-return-colors-that-i-had-after-reverse/
	    }
	  }

	  var pt = new PropTween(this._pt, target.style, prop, 0, 1, _renderComplexString),
	      index = 0,
	      matchIndex = 0,
	      a,
	      result,
	      startValues,
	      startNum,
	      color,
	      startValue,
	      endValue,
	      endNum,
	      chunk,
	      endUnit,
	      startUnit,
	      relative,
	      endValues;
	  pt.b = start;
	  pt.e = end;
	  start += ""; //ensure values are strings

	  end += "";

	  if (end === "auto") {
	    target.style[prop] = end;
	    end = _getComputedProperty(target, prop) || end;
	    target.style[prop] = start;
	  }

	  a = [start, end];

	  _colorStringFilter(a); //pass an array with the starting and ending values and let the filter do whatever it needs to the values. If colors are found, it returns true and then we must match where the color shows up order-wise because for things like boxShadow, sometimes the browser provides the computed values with the color FIRST, but the user provides it with the color LAST, so flip them if necessary. Same for drop-shadow().


	  start = a[0];
	  end = a[1];
	  startValues = start.match(_numWithUnitExp) || [];
	  endValues = end.match(_numWithUnitExp) || [];

	  if (endValues.length) {
	    while (result = _numWithUnitExp.exec(end)) {
	      endValue = result[0];
	      chunk = end.substring(index, result.index);

	      if (color) {
	        color = (color + 1) % 5;
	      } else if (chunk.substr(-5) === "rgba(" || chunk.substr(-5) === "hsla(") {
	        color = 1;
	      }

	      if (endValue !== (startValue = startValues[matchIndex++] || "")) {
	        startNum = parseFloat(startValue) || 0;
	        startUnit = startValue.substr((startNum + "").length);
	        relative = endValue.charAt(1) === "=" ? +(endValue.charAt(0) + "1") : 0;

	        if (relative) {
	          endValue = endValue.substr(2);
	        }

	        endNum = parseFloat(endValue);
	        endUnit = endValue.substr((endNum + "").length);
	        index = _numWithUnitExp.lastIndex - endUnit.length;

	        if (!endUnit) {
	          //if something like "perspective:300" is passed in and we must add a unit to the end
	          endUnit = endUnit || _config.units[prop] || startUnit;

	          if (index === end.length) {
	            end += endUnit;
	            pt.e += endUnit;
	          }
	        }

	        if (startUnit !== endUnit) {
	          startNum = _convertToUnit(target, prop, startValue, endUnit) || 0;
	        } //these nested PropTweens are handled in a special way - we'll never actually call a render or setter method on them. We'll just loop through them in the parent complex string PropTween's render method.


	        pt._pt = {
	          _next: pt._pt,
	          p: chunk || matchIndex === 1 ? chunk : ",",
	          //note: SVG spec allows omission of comma/space when a negative sign is wedged between two numbers, like 2.5-5.3 instead of 2.5,-5.3 but when tweening, the negative value may switch to positive, so we insert the comma just in case.
	          s: startNum,
	          c: relative ? relative * endNum : endNum - startNum,
	          m: color && color < 4 || prop === "zIndex" ? Math.round : 0
	        };
	      }
	    }

	    pt.c = index < end.length ? end.substring(index, end.length) : ""; //we use the "c" of the PropTween to store the final part of the string (after the last number)
	  } else {
	    pt.r = prop === "display" && end === "none" ? _renderNonTweeningValueOnlyAtEnd : _renderNonTweeningValue;
	  }

	  _relExp.test(end) && (pt.e = 0); //if the end string contains relative values or dynamic random(...) values, delete the end it so that on the final render we don't actually set it to the string with += or -= characters (forces it to use the calculated value).

	  this._pt = pt; //start the linked list with this new PropTween. Remember, we call _tweenComplexCSSString.call(pluginInstance...) to ensure that it's scoped properly. We may call it from within another plugin too, thus "this" would refer to the plugin.

	  return pt;
	},
	    _keywordToPercent = {
	  top: "0%",
	  bottom: "100%",
	  left: "0%",
	  right: "100%",
	  center: "50%"
	},
	    _convertKeywordsToPercentages = function _convertKeywordsToPercentages(value) {
	  var split = value.split(" "),
	      x = split[0],
	      y = split[1] || "50%";

	  if (x === "top" || x === "bottom" || y === "left" || y === "right") {
	    //the user provided them in the wrong order, so flip them
	    value = x;
	    x = y;
	    y = value;
	  }

	  split[0] = _keywordToPercent[x] || x;
	  split[1] = _keywordToPercent[y] || y;
	  return split.join(" ");
	},
	    _renderClearProps = function _renderClearProps(ratio, data) {
	  if (data.tween && data.tween._time === data.tween._dur) {
	    var target = data.t,
	        style = target.style,
	        props = data.u,
	        cache = target._gsap,
	        prop,
	        clearTransforms,
	        i;

	    if (props === "all" || props === true) {
	      style.cssText = "";
	      clearTransforms = 1;
	    } else {
	      props = props.split(",");
	      i = props.length;

	      while (--i > -1) {
	        prop = props[i];

	        if (_transformProps[prop]) {
	          clearTransforms = 1;
	          prop = prop === "transformOrigin" ? _transformOriginProp : _transformProp;
	        }

	        _removeProperty(target, prop);
	      }
	    }

	    if (clearTransforms) {
	      _removeProperty(target, _transformProp);

	      if (cache) {
	        cache.svg && target.removeAttribute("transform");

	        _parseTransform(target, 1); // force all the cached values back to "normal"/identity, otherwise if there's another tween that's already set to render transforms on this element, it could display the wrong values.


	        cache.uncache = 1;
	      }
	    }
	  }
	},
	    // note: specialProps should return 1 if (and only if) they have a non-zero priority. It indicates we need to sort the linked list.
	_specialProps = {
	  clearProps: function clearProps(plugin, target, property, endValue, tween) {
	    if (tween.data !== "isFromStart") {
	      var pt = plugin._pt = new PropTween(plugin._pt, target, property, 0, 0, _renderClearProps);
	      pt.u = endValue;
	      pt.pr = -10;
	      pt.tween = tween;

	      plugin._props.push(property);

	      return 1;
	    }
	  }
	  /* className feature (about 0.4kb gzipped).
	  , className(plugin, target, property, endValue, tween) {
	  	let _renderClassName = (ratio, data) => {
	  			data.css.render(ratio, data.css);
	  			if (!ratio || ratio === 1) {
	  				let inline = data.rmv,
	  					target = data.t,
	  					p;
	  				target.setAttribute("class", ratio ? data.e : data.b);
	  				for (p in inline) {
	  					_removeProperty(target, p);
	  				}
	  			}
	  		},
	  		_getAllStyles = (target) => {
	  			let styles = {},
	  				computed = getComputedStyle(target),
	  				p;
	  			for (p in computed) {
	  				if (isNaN(p) && p !== "cssText" && p !== "length") {
	  					styles[p] = computed[p];
	  				}
	  			}
	  			_setDefaults(styles, _parseTransform(target, 1));
	  			return styles;
	  		},
	  		startClassList = target.getAttribute("class"),
	  		style = target.style,
	  		cssText = style.cssText,
	  		cache = target._gsap,
	  		classPT = cache.classPT,
	  		inlineToRemoveAtEnd = {},
	  		data = {t:target, plugin:plugin, rmv:inlineToRemoveAtEnd, b:startClassList, e:(endValue.charAt(1) !== "=") ? endValue : startClassList.replace(new RegExp("(?:\\s|^)" + endValue.substr(2) + "(?![\\w-])"), "") + ((endValue.charAt(0) === "+") ? " " + endValue.substr(2) : "")},
	  		changingVars = {},
	  		startVars = _getAllStyles(target),
	  		transformRelated = /(transform|perspective)/i,
	  		endVars, p;
	  	if (classPT) {
	  		classPT.r(1, classPT.d);
	  		_removeLinkedListItem(classPT.d.plugin, classPT, "_pt");
	  	}
	  	target.setAttribute("class", data.e);
	  	endVars = _getAllStyles(target, true);
	  	target.setAttribute("class", startClassList);
	  	for (p in endVars) {
	  		if (endVars[p] !== startVars[p] && !transformRelated.test(p)) {
	  			changingVars[p] = endVars[p];
	  			if (!style[p] && style[p] !== "0") {
	  				inlineToRemoveAtEnd[p] = 1;
	  			}
	  		}
	  	}
	  	cache.classPT = plugin._pt = new PropTween(plugin._pt, target, "className", 0, 0, _renderClassName, data, 0, -11);
	  	if (style.cssText !== cssText) { //only apply if things change. Otherwise, in cases like a background-image that's pulled dynamically, it could cause a refresh. See https://greensock.com/forums/topic/20368-possible-gsap-bug-switching-classnames-in-chrome/.
	  		style.cssText = cssText; //we recorded cssText before we swapped classes and ran _getAllStyles() because in cases when a className tween is overwritten, we remove all the related tweening properties from that class change (otherwise class-specific stuff can't override properties we've directly set on the target's style object due to specificity).
	  	}
	  	_parseTransform(target, true); //to clear the caching of transforms
	  	data.css = new gsap.plugins.css();
	  	data.css.init(target, changingVars, tween);
	  	plugin._props.push(...data.css._props);
	  	return 1;
	  }
	  */

	},

	/*
	 * --------------------------------------------------------------------------------------
	 * TRANSFORMS
	 * --------------------------------------------------------------------------------------
	 */
	_identity2DMatrix = [1, 0, 0, 1, 0, 0],
	    _rotationalProperties = {},
	    _isNullTransform = function _isNullTransform(value) {
	  return value === "matrix(1, 0, 0, 1, 0, 0)" || value === "none" || !value;
	},
	    _getComputedTransformMatrixAsArray = function _getComputedTransformMatrixAsArray(target) {
	  var matrixString = _getComputedProperty(target, _transformProp);

	  return _isNullTransform(matrixString) ? _identity2DMatrix : matrixString.substr(7).match(_numExp).map(_round);
	},
	    _getMatrix = function _getMatrix(target, force2D) {
	  var cache = target._gsap || _getCache(target),
	      style = target.style,
	      matrix = _getComputedTransformMatrixAsArray(target),
	      parent,
	      nextSibling,
	      temp,
	      addedToDOM;

	  if (cache.svg && target.getAttribute("transform")) {
	    temp = target.transform.baseVal.consolidate().matrix; //ensures that even complex values like "translate(50,60) rotate(135,0,0)" are parsed because it mashes it into a matrix.

	    matrix = [temp.a, temp.b, temp.c, temp.d, temp.e, temp.f];
	    return matrix.join(",") === "1,0,0,1,0,0" ? _identity2DMatrix : matrix;
	  } else if (matrix === _identity2DMatrix && !target.offsetParent && target !== _docElement && !cache.svg) {
	    //note: if offsetParent is null, that means the element isn't in the normal document flow, like if it has display:none or one of its ancestors has display:none). Firefox returns null for getComputedStyle() if the element is in an iframe that has display:none. https://bugzilla.mozilla.org/show_bug.cgi?id=548397
	    //browsers don't report transforms accurately unless the element is in the DOM and has a display value that's not "none". Firefox and Microsoft browsers have a partial bug where they'll report transforms even if display:none BUT not any percentage-based values like translate(-50%, 8px) will be reported as if it's translate(0, 8px).
	    temp = style.display;
	    style.display = "block";
	    parent = target.parentNode;

	    if (!parent || !target.offsetParent) {
	      // note: in 3.3.0 we switched target.offsetParent to _doc.body.contains(target) to avoid [sometimes unnecessary] MutationObserver calls but that wasn't adequate because there are edge cases where nested position: fixed elements need to get reparented to accurately sense transforms. See https://github.com/greensock/GSAP/issues/388 and https://github.com/greensock/GSAP/issues/375
	      addedToDOM = 1; //flag

	      nextSibling = target.nextSibling;

	      _docElement.appendChild(target); //we must add it to the DOM in order to get values properly

	    }

	    matrix = _getComputedTransformMatrixAsArray(target);
	    temp ? style.display = temp : _removeProperty(target, "display");

	    if (addedToDOM) {
	      nextSibling ? parent.insertBefore(target, nextSibling) : parent ? parent.appendChild(target) : _docElement.removeChild(target);
	    }
	  }

	  return force2D && matrix.length > 6 ? [matrix[0], matrix[1], matrix[4], matrix[5], matrix[12], matrix[13]] : matrix;
	},
	    _applySVGOrigin = function _applySVGOrigin(target, origin, originIsAbsolute, smooth, matrixArray, pluginToAddPropTweensTo) {
	  var cache = target._gsap,
	      matrix = matrixArray || _getMatrix(target, true),
	      xOriginOld = cache.xOrigin || 0,
	      yOriginOld = cache.yOrigin || 0,
	      xOffsetOld = cache.xOffset || 0,
	      yOffsetOld = cache.yOffset || 0,
	      a = matrix[0],
	      b = matrix[1],
	      c = matrix[2],
	      d = matrix[3],
	      tx = matrix[4],
	      ty = matrix[5],
	      originSplit = origin.split(" "),
	      xOrigin = parseFloat(originSplit[0]) || 0,
	      yOrigin = parseFloat(originSplit[1]) || 0,
	      bounds,
	      determinant,
	      x,
	      y;

	  if (!originIsAbsolute) {
	    bounds = _getBBox(target);
	    xOrigin = bounds.x + (~originSplit[0].indexOf("%") ? xOrigin / 100 * bounds.width : xOrigin);
	    yOrigin = bounds.y + (~(originSplit[1] || originSplit[0]).indexOf("%") ? yOrigin / 100 * bounds.height : yOrigin);
	  } else if (matrix !== _identity2DMatrix && (determinant = a * d - b * c)) {
	    //if it's zero (like if scaleX and scaleY are zero), skip it to avoid errors with dividing by zero.
	    x = xOrigin * (d / determinant) + yOrigin * (-c / determinant) + (c * ty - d * tx) / determinant;
	    y = xOrigin * (-b / determinant) + yOrigin * (a / determinant) - (a * ty - b * tx) / determinant;
	    xOrigin = x;
	    yOrigin = y;
	  }

	  if (smooth || smooth !== false && cache.smooth) {
	    tx = xOrigin - xOriginOld;
	    ty = yOrigin - yOriginOld;
	    cache.xOffset = xOffsetOld + (tx * a + ty * c) - tx;
	    cache.yOffset = yOffsetOld + (tx * b + ty * d) - ty;
	  } else {
	    cache.xOffset = cache.yOffset = 0;
	  }

	  cache.xOrigin = xOrigin;
	  cache.yOrigin = yOrigin;
	  cache.smooth = !!smooth;
	  cache.origin = origin;
	  cache.originIsAbsolute = !!originIsAbsolute;
	  target.style[_transformOriginProp] = "0px 0px"; //otherwise, if someone sets  an origin via CSS, it will likely interfere with the SVG transform attribute ones (because remember, we're baking the origin into the matrix() value).

	  if (pluginToAddPropTweensTo) {
	    _addNonTweeningPT(pluginToAddPropTweensTo, cache, "xOrigin", xOriginOld, xOrigin);

	    _addNonTweeningPT(pluginToAddPropTweensTo, cache, "yOrigin", yOriginOld, yOrigin);

	    _addNonTweeningPT(pluginToAddPropTweensTo, cache, "xOffset", xOffsetOld, cache.xOffset);

	    _addNonTweeningPT(pluginToAddPropTweensTo, cache, "yOffset", yOffsetOld, cache.yOffset);
	  }

	  target.setAttribute("data-svg-origin", xOrigin + " " + yOrigin);
	},
	    _parseTransform = function _parseTransform(target, uncache) {
	  var cache = target._gsap || new GSCache(target);

	  if ("x" in cache && !uncache && !cache.uncache) {
	    return cache;
	  }

	  var style = target.style,
	      invertedScaleX = cache.scaleX < 0,
	      px = "px",
	      deg = "deg",
	      origin = _getComputedProperty(target, _transformOriginProp) || "0",
	      x,
	      y,
	      z,
	      scaleX,
	      scaleY,
	      rotation,
	      rotationX,
	      rotationY,
	      skewX,
	      skewY,
	      perspective,
	      xOrigin,
	      yOrigin,
	      matrix,
	      angle,
	      cos,
	      sin,
	      a,
	      b,
	      c,
	      d,
	      a12,
	      a22,
	      t1,
	      t2,
	      t3,
	      a13,
	      a23,
	      a33,
	      a42,
	      a43,
	      a32;
	  x = y = z = rotation = rotationX = rotationY = skewX = skewY = perspective = 0;
	  scaleX = scaleY = 1;
	  cache.svg = !!(target.getCTM && _isSVG(target));
	  matrix = _getMatrix(target, cache.svg);

	  if (cache.svg) {
	    t1 = (!cache.uncache || origin === "0px 0px") && !uncache && target.getAttribute("data-svg-origin"); // if origin is 0,0 and cache.uncache is true, let the recorded data-svg-origin stay. Otherwise, whenever we set cache.uncache to true, we'd need to set element.style.transformOrigin = (cache.xOrigin - bbox.x) + "px " + (cache.yOrigin - bbox.y) + "px". Remember, to work around browser inconsistencies we always force SVG elements' transformOrigin to 0,0 and offset the translation accordingly.

	    _applySVGOrigin(target, t1 || origin, !!t1 || cache.originIsAbsolute, cache.smooth !== false, matrix);
	  }

	  xOrigin = cache.xOrigin || 0;
	  yOrigin = cache.yOrigin || 0;

	  if (matrix !== _identity2DMatrix) {
	    a = matrix[0]; //a11

	    b = matrix[1]; //a21

	    c = matrix[2]; //a31

	    d = matrix[3]; //a41

	    x = a12 = matrix[4];
	    y = a22 = matrix[5]; //2D matrix

	    if (matrix.length === 6) {
	      scaleX = Math.sqrt(a * a + b * b);
	      scaleY = Math.sqrt(d * d + c * c);
	      rotation = a || b ? _atan2(b, a) * _RAD2DEG : 0; //note: if scaleX is 0, we cannot accurately measure rotation. Same for skewX with a scaleY of 0. Therefore, we default to the previously recorded value (or zero if that doesn't exist).

	      skewX = c || d ? _atan2(c, d) * _RAD2DEG + rotation : 0;
	      skewX && (scaleY *= Math.abs(Math.cos(skewX * _DEG2RAD)));

	      if (cache.svg) {
	        x -= xOrigin - (xOrigin * a + yOrigin * c);
	        y -= yOrigin - (xOrigin * b + yOrigin * d);
	      } //3D matrix

	    } else {
	      a32 = matrix[6];
	      a42 = matrix[7];
	      a13 = matrix[8];
	      a23 = matrix[9];
	      a33 = matrix[10];
	      a43 = matrix[11];
	      x = matrix[12];
	      y = matrix[13];
	      z = matrix[14];
	      angle = _atan2(a32, a33);
	      rotationX = angle * _RAD2DEG; //rotationX

	      if (angle) {
	        cos = Math.cos(-angle);
	        sin = Math.sin(-angle);
	        t1 = a12 * cos + a13 * sin;
	        t2 = a22 * cos + a23 * sin;
	        t3 = a32 * cos + a33 * sin;
	        a13 = a12 * -sin + a13 * cos;
	        a23 = a22 * -sin + a23 * cos;
	        a33 = a32 * -sin + a33 * cos;
	        a43 = a42 * -sin + a43 * cos;
	        a12 = t1;
	        a22 = t2;
	        a32 = t3;
	      } //rotationY


	      angle = _atan2(-c, a33);
	      rotationY = angle * _RAD2DEG;

	      if (angle) {
	        cos = Math.cos(-angle);
	        sin = Math.sin(-angle);
	        t1 = a * cos - a13 * sin;
	        t2 = b * cos - a23 * sin;
	        t3 = c * cos - a33 * sin;
	        a43 = d * sin + a43 * cos;
	        a = t1;
	        b = t2;
	        c = t3;
	      } //rotationZ


	      angle = _atan2(b, a);
	      rotation = angle * _RAD2DEG;

	      if (angle) {
	        cos = Math.cos(angle);
	        sin = Math.sin(angle);
	        t1 = a * cos + b * sin;
	        t2 = a12 * cos + a22 * sin;
	        b = b * cos - a * sin;
	        a22 = a22 * cos - a12 * sin;
	        a = t1;
	        a12 = t2;
	      }

	      if (rotationX && Math.abs(rotationX) + Math.abs(rotation) > 359.9) {
	        //when rotationY is set, it will often be parsed as 180 degrees different than it should be, and rotationX and rotation both being 180 (it looks the same), so we adjust for that here.
	        rotationX = rotation = 0;
	        rotationY = 180 - rotationY;
	      }

	      scaleX = _round(Math.sqrt(a * a + b * b + c * c));
	      scaleY = _round(Math.sqrt(a22 * a22 + a32 * a32));
	      angle = _atan2(a12, a22);
	      skewX = Math.abs(angle) > 0.0002 ? angle * _RAD2DEG : 0;
	      perspective = a43 ? 1 / (a43 < 0 ? -a43 : a43) : 0;
	    }

	    if (cache.svg) {
	      //sense if there are CSS transforms applied on an SVG element in which case we must overwrite them when rendering. The transform attribute is more reliable cross-browser, but we can't just remove the CSS ones because they may be applied in a CSS rule somewhere (not just inline).
	      t1 = target.getAttribute("transform");
	      cache.forceCSS = target.setAttribute("transform", "") || !_isNullTransform(_getComputedProperty(target, _transformProp));
	      t1 && target.setAttribute("transform", t1);
	    }
	  }

	  if (Math.abs(skewX) > 90 && Math.abs(skewX) < 270) {
	    if (invertedScaleX) {
	      scaleX *= -1;
	      skewX += rotation <= 0 ? 180 : -180;
	      rotation += rotation <= 0 ? 180 : -180;
	    } else {
	      scaleY *= -1;
	      skewX += skewX <= 0 ? 180 : -180;
	    }
	  }

	  cache.x = x - ((cache.xPercent = x && (cache.xPercent || (Math.round(target.offsetWidth / 2) === Math.round(-x) ? -50 : 0))) ? target.offsetWidth * cache.xPercent / 100 : 0) + px;
	  cache.y = y - ((cache.yPercent = y && (cache.yPercent || (Math.round(target.offsetHeight / 2) === Math.round(-y) ? -50 : 0))) ? target.offsetHeight * cache.yPercent / 100 : 0) + px;
	  cache.z = z + px;
	  cache.scaleX = _round(scaleX);
	  cache.scaleY = _round(scaleY);
	  cache.rotation = _round(rotation) + deg;
	  cache.rotationX = _round(rotationX) + deg;
	  cache.rotationY = _round(rotationY) + deg;
	  cache.skewX = skewX + deg;
	  cache.skewY = skewY + deg;
	  cache.transformPerspective = perspective + px;

	  if (cache.zOrigin = parseFloat(origin.split(" ")[2]) || 0) {
	    style[_transformOriginProp] = _firstTwoOnly(origin);
	  }

	  cache.xOffset = cache.yOffset = 0;
	  cache.force3D = _config.force3D;
	  cache.renderTransform = cache.svg ? _renderSVGTransforms : _supports3D ? _renderCSSTransforms : _renderNon3DTransforms;
	  cache.uncache = 0;
	  return cache;
	},
	    _firstTwoOnly = function _firstTwoOnly(value) {
	  return (value = value.split(" "))[0] + " " + value[1];
	},
	    //for handling transformOrigin values, stripping out the 3rd dimension
	_addPxTranslate = function _addPxTranslate(target, start, value) {
	  var unit = getUnit(start);
	  return _round(parseFloat(start) + parseFloat(_convertToUnit(target, "x", value + "px", unit))) + unit;
	},
	    _renderNon3DTransforms = function _renderNon3DTransforms(ratio, cache) {
	  cache.z = "0px";
	  cache.rotationY = cache.rotationX = "0deg";
	  cache.force3D = 0;

	  _renderCSSTransforms(ratio, cache);
	},
	    _zeroDeg = "0deg",
	    _zeroPx = "0px",
	    _endParenthesis = ") ",
	    _renderCSSTransforms = function _renderCSSTransforms(ratio, cache) {
	  var _ref = cache || this,
	      xPercent = _ref.xPercent,
	      yPercent = _ref.yPercent,
	      x = _ref.x,
	      y = _ref.y,
	      z = _ref.z,
	      rotation = _ref.rotation,
	      rotationY = _ref.rotationY,
	      rotationX = _ref.rotationX,
	      skewX = _ref.skewX,
	      skewY = _ref.skewY,
	      scaleX = _ref.scaleX,
	      scaleY = _ref.scaleY,
	      transformPerspective = _ref.transformPerspective,
	      force3D = _ref.force3D,
	      target = _ref.target,
	      zOrigin = _ref.zOrigin,
	      transforms = "",
	      use3D = force3D === "auto" && ratio && ratio !== 1 || force3D === true; // Safari has a bug that causes it not to render 3D transform-origin values properly, so we force the z origin to 0, record it in the cache, and then do the math here to offset the translate values accordingly (basically do the 3D transform-origin part manually)


	  if (zOrigin && (rotationX !== _zeroDeg || rotationY !== _zeroDeg)) {
	    var angle = parseFloat(rotationY) * _DEG2RAD,
	        a13 = Math.sin(angle),
	        a33 = Math.cos(angle),
	        cos;

	    angle = parseFloat(rotationX) * _DEG2RAD;
	    cos = Math.cos(angle);
	    x = _addPxTranslate(target, x, a13 * cos * -zOrigin);
	    y = _addPxTranslate(target, y, -Math.sin(angle) * -zOrigin);
	    z = _addPxTranslate(target, z, a33 * cos * -zOrigin + zOrigin);
	  }

	  if (transformPerspective !== _zeroPx) {
	    transforms += "perspective(" + transformPerspective + _endParenthesis;
	  }

	  if (xPercent || yPercent) {
	    transforms += "translate(" + xPercent + "%, " + yPercent + "%) ";
	  }

	  if (use3D || x !== _zeroPx || y !== _zeroPx || z !== _zeroPx) {
	    transforms += z !== _zeroPx || use3D ? "translate3d(" + x + ", " + y + ", " + z + ") " : "translate(" + x + ", " + y + _endParenthesis;
	  }

	  if (rotation !== _zeroDeg) {
	    transforms += "rotate(" + rotation + _endParenthesis;
	  }

	  if (rotationY !== _zeroDeg) {
	    transforms += "rotateY(" + rotationY + _endParenthesis;
	  }

	  if (rotationX !== _zeroDeg) {
	    transforms += "rotateX(" + rotationX + _endParenthesis;
	  }

	  if (skewX !== _zeroDeg || skewY !== _zeroDeg) {
	    transforms += "skew(" + skewX + ", " + skewY + _endParenthesis;
	  }

	  if (scaleX !== 1 || scaleY !== 1) {
	    transforms += "scale(" + scaleX + ", " + scaleY + _endParenthesis;
	  }

	  target.style[_transformProp] = transforms || "translate(0, 0)";
	},
	    _renderSVGTransforms = function _renderSVGTransforms(ratio, cache) {
	  var _ref2 = cache || this,
	      xPercent = _ref2.xPercent,
	      yPercent = _ref2.yPercent,
	      x = _ref2.x,
	      y = _ref2.y,
	      rotation = _ref2.rotation,
	      skewX = _ref2.skewX,
	      skewY = _ref2.skewY,
	      scaleX = _ref2.scaleX,
	      scaleY = _ref2.scaleY,
	      target = _ref2.target,
	      xOrigin = _ref2.xOrigin,
	      yOrigin = _ref2.yOrigin,
	      xOffset = _ref2.xOffset,
	      yOffset = _ref2.yOffset,
	      forceCSS = _ref2.forceCSS,
	      tx = parseFloat(x),
	      ty = parseFloat(y),
	      a11,
	      a21,
	      a12,
	      a22,
	      temp;

	  rotation = parseFloat(rotation);
	  skewX = parseFloat(skewX);
	  skewY = parseFloat(skewY);

	  if (skewY) {
	    //for performance reasons, we combine all skewing into the skewX and rotation values. Remember, a skewY of 10 degrees looks the same as a rotation of 10 degrees plus a skewX of 10 degrees.
	    skewY = parseFloat(skewY);
	    skewX += skewY;
	    rotation += skewY;
	  }

	  if (rotation || skewX) {
	    rotation *= _DEG2RAD;
	    skewX *= _DEG2RAD;
	    a11 = Math.cos(rotation) * scaleX;
	    a21 = Math.sin(rotation) * scaleX;
	    a12 = Math.sin(rotation - skewX) * -scaleY;
	    a22 = Math.cos(rotation - skewX) * scaleY;

	    if (skewX) {
	      skewY *= _DEG2RAD;
	      temp = Math.tan(skewX - skewY);
	      temp = Math.sqrt(1 + temp * temp);
	      a12 *= temp;
	      a22 *= temp;

	      if (skewY) {
	        temp = Math.tan(skewY);
	        temp = Math.sqrt(1 + temp * temp);
	        a11 *= temp;
	        a21 *= temp;
	      }
	    }

	    a11 = _round(a11);
	    a21 = _round(a21);
	    a12 = _round(a12);
	    a22 = _round(a22);
	  } else {
	    a11 = scaleX;
	    a22 = scaleY;
	    a21 = a12 = 0;
	  }

	  if (tx && !~(x + "").indexOf("px") || ty && !~(y + "").indexOf("px")) {
	    tx = _convertToUnit(target, "x", x, "px");
	    ty = _convertToUnit(target, "y", y, "px");
	  }

	  if (xOrigin || yOrigin || xOffset || yOffset) {
	    tx = _round(tx + xOrigin - (xOrigin * a11 + yOrigin * a12) + xOffset);
	    ty = _round(ty + yOrigin - (xOrigin * a21 + yOrigin * a22) + yOffset);
	  }

	  if (xPercent || yPercent) {
	    //The SVG spec doesn't support percentage-based translation in the "transform" attribute, so we merge it into the translation to simulate it.
	    temp = target.getBBox();
	    tx = _round(tx + xPercent / 100 * temp.width);
	    ty = _round(ty + yPercent / 100 * temp.height);
	  }

	  temp = "matrix(" + a11 + "," + a21 + "," + a12 + "," + a22 + "," + tx + "," + ty + ")";
	  target.setAttribute("transform", temp);
	  forceCSS && (target.style[_transformProp] = temp); //some browsers prioritize CSS transforms over the transform attribute. When we sense that the user has CSS transforms applied, we must overwrite them this way (otherwise some browser simply won't render the  transform attribute changes!)
	},
	    _addRotationalPropTween = function _addRotationalPropTween(plugin, target, property, startNum, endValue, relative) {
	  var cap = 360,
	      isString = _isString(endValue),
	      endNum = parseFloat(endValue) * (isString && ~endValue.indexOf("rad") ? _RAD2DEG : 1),
	      change = relative ? endNum * relative : endNum - startNum,
	      finalValue = startNum + change + "deg",
	      direction,
	      pt;

	  if (isString) {
	    direction = endValue.split("_")[1];

	    if (direction === "short") {
	      change %= cap;

	      if (change !== change % (cap / 2)) {
	        change += change < 0 ? cap : -cap;
	      }
	    }

	    if (direction === "cw" && change < 0) {
	      change = (change + cap * _bigNum) % cap - ~~(change / cap) * cap;
	    } else if (direction === "ccw" && change > 0) {
	      change = (change - cap * _bigNum) % cap - ~~(change / cap) * cap;
	    }
	  }

	  plugin._pt = pt = new PropTween(plugin._pt, target, property, startNum, change, _renderPropWithEnd);
	  pt.e = finalValue;
	  pt.u = "deg";

	  plugin._props.push(property);

	  return pt;
	},
	    _assign = function _assign(target, source) {
	  // Internet Explorer doesn't have Object.assign(), so we recreate it here.
	  for (var p in source) {
	    target[p] = source[p];
	  }

	  return target;
	},
	    _addRawTransformPTs = function _addRawTransformPTs(plugin, transforms, target) {
	  //for handling cases where someone passes in a whole transform string, like transform: "scale(2, 3) rotate(20deg) translateY(30em)"
	  var startCache = _assign({}, target._gsap),
	      exclude = "perspective,force3D,transformOrigin,svgOrigin",
	      style = target.style,
	      endCache,
	      p,
	      startValue,
	      endValue,
	      startNum,
	      endNum,
	      startUnit,
	      endUnit;

	  if (startCache.svg) {
	    startValue = target.getAttribute("transform");
	    target.setAttribute("transform", "");
	    style[_transformProp] = transforms;
	    endCache = _parseTransform(target, 1);

	    _removeProperty(target, _transformProp);

	    target.setAttribute("transform", startValue);
	  } else {
	    startValue = getComputedStyle(target)[_transformProp];
	    style[_transformProp] = transforms;
	    endCache = _parseTransform(target, 1);
	    style[_transformProp] = startValue;
	  }

	  for (p in _transformProps) {
	    startValue = startCache[p];
	    endValue = endCache[p];

	    if (startValue !== endValue && exclude.indexOf(p) < 0) {
	      //tweening to no perspective gives very unintuitive results - just keep the same perspective in that case.
	      startUnit = getUnit(startValue);
	      endUnit = getUnit(endValue);
	      startNum = startUnit !== endUnit ? _convertToUnit(target, p, startValue, endUnit) : parseFloat(startValue);
	      endNum = parseFloat(endValue);
	      plugin._pt = new PropTween(plugin._pt, endCache, p, startNum, endNum - startNum, _renderCSSProp);
	      plugin._pt.u = endUnit || 0;

	      plugin._props.push(p);
	    }
	  }

	  _assign(endCache, startCache);
	}; // handle splitting apart padding, margin, borderWidth, and borderRadius into their 4 components. Firefox, for example, won't report borderRadius correctly - it will only do borderTopLeftRadius and the other corners. We also want to handle paddingTop, marginLeft, borderRightWidth, etc.


	_forEachName("padding,margin,Width,Radius", function (name, index) {
	  var t = "Top",
	      r = "Right",
	      b = "Bottom",
	      l = "Left",
	      props = (index < 3 ? [t, r, b, l] : [t + l, t + r, b + r, b + l]).map(function (side) {
	    return index < 2 ? name + side : "border" + side + name;
	  });

	  _specialProps[index > 1 ? "border" + name : name] = function (plugin, target, property, endValue, tween) {
	    var a, vars;

	    if (arguments.length < 4) {
	      // getter, passed target, property, and unit (from _get())
	      a = props.map(function (prop) {
	        return _get(plugin, prop, property);
	      });
	      vars = a.join(" ");
	      return vars.split(a[0]).length === 5 ? a[0] : vars;
	    }

	    a = (endValue + "").split(" ");
	    vars = {};
	    props.forEach(function (prop, i) {
	      return vars[prop] = a[i] = a[i] || a[(i - 1) / 2 | 0];
	    });
	    plugin.init(target, vars, tween);
	  };
	});

	var CSSPlugin = {
	  name: "css",
	  register: _initCore,
	  targetTest: function targetTest(target) {
	    return target.style && target.nodeType;
	  },
	  init: function init(target, vars, tween, index, targets) {
	    var props = this._props,
	        style = target.style,
	        startAt = tween.vars.startAt,
	        startValue,
	        endValue,
	        endNum,
	        startNum,
	        type,
	        specialProp,
	        p,
	        startUnit,
	        endUnit,
	        relative,
	        isTransformRelated,
	        transformPropTween,
	        cache,
	        smooth,
	        hasPriority;
	    _pluginInitted || _initCore();

	    for (p in vars) {
	      if (p === "autoRound") {
	        continue;
	      }

	      endValue = vars[p];

	      if (_plugins[p] && _checkPlugin(p, vars, tween, index, target, targets)) {
	        // plugins
	        continue;
	      }

	      type = typeof endValue;
	      specialProp = _specialProps[p];

	      if (type === "function") {
	        endValue = endValue.call(tween, index, target, targets);
	        type = typeof endValue;
	      }

	      if (type === "string" && ~endValue.indexOf("random(")) {
	        endValue = _replaceRandom(endValue);
	      }

	      if (specialProp) {
	        specialProp(this, target, p, endValue, tween) && (hasPriority = 1);
	      } else if (p.substr(0, 2) === "--") {
	        //CSS variable
	        startValue = (getComputedStyle(target).getPropertyValue(p) + "").trim();
	        endValue += "";
	        _colorExp.lastIndex = 0;

	        if (!_colorExp.test(startValue)) {
	          // colors don't have units
	          startUnit = getUnit(startValue);
	          endUnit = getUnit(endValue);
	        }

	        endUnit ? startUnit !== endUnit && (startValue = _convertToUnit(target, p, startValue, endUnit) + endUnit) : startUnit && (endValue += startUnit);
	        this.add(style, "setProperty", startValue, endValue, index, targets, 0, 0, p);
	        props.push(p);
	      } else if (type !== "undefined") {
	        if (startAt && p in startAt) {
	          // in case someone hard-codes a complex value as the start, like top: "calc(2vh / 2)". Without this, it'd use the computed value (always in px)
	          startValue = typeof startAt[p] === "function" ? startAt[p].call(tween, index, target, targets) : startAt[p];
	          p in _config.units && !getUnit(startValue) && (startValue += _config.units[p]); // for cases when someone passes in a unitless value like {x: 100}; if we try setting translate(100, 0px) it won't work.

	          _isString(startValue) && ~startValue.indexOf("random(") && (startValue = _replaceRandom(startValue));
	          (startValue + "").charAt(1) === "=" && (startValue = _get(target, p)); // can't work with relative values
	        } else {
	          startValue = _get(target, p);
	        }

	        startNum = parseFloat(startValue);
	        relative = type === "string" && endValue.charAt(1) === "=" ? +(endValue.charAt(0) + "1") : 0;
	        relative && (endValue = endValue.substr(2));
	        endNum = parseFloat(endValue);

	        if (p in _propertyAliases) {
	          if (p === "autoAlpha") {
	            //special case where we control the visibility along with opacity. We still allow the opacity value to pass through and get tweened.
	            if (startNum === 1 && _get(target, "visibility") === "hidden" && endNum) {
	              //if visibility is initially set to "hidden", we should interpret that as intent to make opacity 0 (a convenience)
	              startNum = 0;
	            }

	            _addNonTweeningPT(this, style, "visibility", startNum ? "inherit" : "hidden", endNum ? "inherit" : "hidden", !endNum);
	          }

	          if (p !== "scale" && p !== "transform") {
	            p = _propertyAliases[p];
	            ~p.indexOf(",") && (p = p.split(",")[0]);
	          }
	        }

	        isTransformRelated = p in _transformProps; //--- TRANSFORM-RELATED ---

	        if (isTransformRelated) {
	          if (!transformPropTween) {
	            cache = target._gsap;
	            cache.renderTransform && !vars.parseTransform || _parseTransform(target, vars.parseTransform); // if, for example, gsap.set(... {transform:"translateX(50vw)"}), the _get() call doesn't parse the transform, thus cache.renderTransform won't be set yet so force the parsing of the transform here.

	            smooth = vars.smoothOrigin !== false && cache.smooth;
	            transformPropTween = this._pt = new PropTween(this._pt, style, _transformProp, 0, 1, cache.renderTransform, cache, 0, -1); //the first time through, create the rendering PropTween so that it runs LAST (in the linked list, we keep adding to the beginning)

	            transformPropTween.dep = 1; //flag it as dependent so that if things get killed/overwritten and this is the only PropTween left, we can safely kill the whole tween.
	          }

	          if (p === "scale") {
	            this._pt = new PropTween(this._pt, cache, "scaleY", cache.scaleY, (relative ? relative * endNum : endNum - cache.scaleY) || 0);
	            props.push("scaleY", p);
	            p += "X";
	          } else if (p === "transformOrigin") {
	            endValue = _convertKeywordsToPercentages(endValue); //in case something like "left top" or "bottom right" is passed in. Convert to percentages.

	            if (cache.svg) {
	              _applySVGOrigin(target, endValue, 0, smooth, 0, this);
	            } else {
	              endUnit = parseFloat(endValue.split(" ")[2]) || 0; //handle the zOrigin separately!

	              endUnit !== cache.zOrigin && _addNonTweeningPT(this, cache, "zOrigin", cache.zOrigin, endUnit);

	              _addNonTweeningPT(this, style, p, _firstTwoOnly(startValue), _firstTwoOnly(endValue));
	            }

	            continue;
	          } else if (p === "svgOrigin") {
	            _applySVGOrigin(target, endValue, 1, smooth, 0, this);

	            continue;
	          } else if (p in _rotationalProperties) {
	            _addRotationalPropTween(this, cache, p, startNum, endValue, relative);

	            continue;
	          } else if (p === "smoothOrigin") {
	            _addNonTweeningPT(this, cache, "smooth", cache.smooth, endValue);

	            continue;
	          } else if (p === "force3D") {
	            cache[p] = endValue;
	            continue;
	          } else if (p === "transform") {
	            _addRawTransformPTs(this, endValue, target);

	            continue;
	          }
	        } else if (!(p in style)) {
	          p = _checkPropPrefix(p) || p;
	        }

	        if (isTransformRelated || (endNum || endNum === 0) && (startNum || startNum === 0) && !_complexExp.test(endValue) && p in style) {
	          startUnit = (startValue + "").substr((startNum + "").length);
	          endNum || (endNum = 0); // protect against NaN

	          endUnit = getUnit(endValue) || (p in _config.units ? _config.units[p] : startUnit);
	          startUnit !== endUnit && (startNum = _convertToUnit(target, p, startValue, endUnit));
	          this._pt = new PropTween(this._pt, isTransformRelated ? cache : style, p, startNum, relative ? relative * endNum : endNum - startNum, !isTransformRelated && (endUnit === "px" || p === "zIndex") && vars.autoRound !== false ? _renderRoundedCSSProp : _renderCSSProp);
	          this._pt.u = endUnit || 0;

	          if (startUnit !== endUnit && endUnit !== "%") {
	            //when the tween goes all the way back to the beginning, we need to revert it to the OLD/ORIGINAL value (with those units). We record that as a "b" (beginning) property and point to a render method that handles that. (performance optimization)
	            this._pt.b = startValue;
	            this._pt.r = _renderCSSPropWithBeginning;
	          }
	        } else if (!(p in style)) {
	          if (p in target) {
	            //maybe it's not a style - it could be a property added directly to an element in which case we'll try to animate that.
	            this.add(target, p, startValue || target[p], endValue, index, targets);
	          } else {
	            _missingPlugin(p, endValue);

	            continue;
	          }
	        } else {
	          _tweenComplexCSSString.call(this, target, p, startValue, endValue);
	        }

	        props.push(p);
	      }
	    }

	    hasPriority && _sortPropTweensByPriority(this);
	  },
	  get: _get,
	  aliases: _propertyAliases,
	  getSetter: function getSetter(target, property, plugin) {
	    //returns a setter function that accepts target, property, value and applies it accordingly. Remember, properties like "x" aren't as simple as target.style.property = value because they've got to be applied to a proxy object and then merged into a transform string in a renderer.
	    var p = _propertyAliases[property];
	    p && p.indexOf(",") < 0 && (property = p);
	    return property in _transformProps && property !== _transformOriginProp && (target._gsap.x || _get(target, "x")) ? plugin && _recentSetterPlugin === plugin ? property === "scale" ? _setterScale : _setterTransform : (_recentSetterPlugin = plugin || {}) && (property === "scale" ? _setterScaleWithRender : _setterTransformWithRender) : target.style && !_isUndefined(target.style[property]) ? _setterCSSStyle : ~property.indexOf("-") ? _setterCSSProp : _getSetter(target, property);
	  },
	  core: {
	    _removeProperty: _removeProperty,
	    _getMatrix: _getMatrix
	  }
	};
	gsap.utils.checkPrefix = _checkPropPrefix;

	(function (positionAndScale, rotation, others, aliases) {
	  var all = _forEachName(positionAndScale + "," + rotation + "," + others, function (name) {
	    _transformProps[name] = 1;
	  });

	  _forEachName(rotation, function (name) {
	    _config.units[name] = "deg";
	    _rotationalProperties[name] = 1;
	  });

	  _propertyAliases[all[13]] = positionAndScale + "," + rotation;

	  _forEachName(aliases, function (name) {
	    var split = name.split(":");
	    _propertyAliases[split[1]] = all[split[0]];
	  });
	})("x,y,z,scale,scaleX,scaleY,xPercent,yPercent", "rotation,rotationX,rotationY,skewX,skewY", "transform,transformOrigin,svgOrigin,force3D,smoothOrigin,transformPerspective", "0:translateX,1:translateY,2:translateZ,8:rotate,8:rotationZ,8:rotateZ,9:rotateX,10:rotateY");

	_forEachName("x,y,z,top,right,bottom,left,width,height,fontSize,padding,margin,perspective", function (name) {
	  _config.units[name] = "px";
	});

	gsap.registerPlugin(CSSPlugin);

	var gsapWithCSS = gsap.registerPlugin(CSSPlugin) || gsap;
	    // to protect from tree shaking
	gsapWithCSS.core.Tween;

	var Contours = (node => {
	  return {
	    oncreate: node => {
	      new Renderer(node.dom.querySelector('canvas').getContext('webgl'), node.attrs);
	    },
	    view: node => c("div", {
	      class: "contours"
	    }, c("canvas", {
	      width: node.attrs.width,
	      height: node.attrs.height
	    }))
	  };
	});

	class Renderer {
	  constructor(gl, cfg) {
	    this.gl = gl;

	    switch (cfg.mode) {
	      case 'splash':
	        this.makeSplashGeometry();
	        this.setSplashColors();
	        break;

	      case 'card':
	        this.makeCardGeometry();
	        this.makeGradient(cfg.color);
	    }

	    this.initGL();
	    this.render();
	  }

	  makeSplashGeometry() {
	    this.angle = Math.PI * 0.6;
	    this.indent = [[1, 0.9, 1, 0.2], [0.4, 0.2, 0.7, -0.1]];
	    /*gsap.to(this.indent[0], {
	    	'3': -0.55,
	    	duration: 1.5,
	    	ease: 'power1.out'
	    })*/

	    let fx = () => {
	      this.x1 = 0;
	      this.x2 = -0.45;
	      this.x3 = Math.PI * 0.9;
	      gsapWithCSS.to(this, {
	        x1: 1,
	        duration: 1,
	        ease: 'power1.out'
	      });
	      gsapWithCSS.to(this, {
	        x2: 0.2,
	        duration: 2,
	        ease: 'power1.inOut'
	      });
	    };

	    fx();
	  }

	  makeGradient(color) {
	    let base = colorlib.hexToRgb(color);
	    let hsv = colorlib.rgbToHsv(base);
	    let ahsv = {
	      h: hsv.h + Math.PI * 0.98,
	      s: hsv.s * 0.2,
	      v: hsv.v * 1.3
	    };
	    let alter = colorlib.hsvToRgb(ahsv);
	    let alterVec = [alter.r / 255, alter.g / 255, alter.b / 255, 1];
	    let baseVec = [base.r / 255, base.g / 255, base.b / 255, 1];
	    this.color = [...baseVec, ...alterVec, ...baseVec, ...alterVec];
	  }

	  setSplashColors() {
	    let color = [];
	    let hexs = ['#00ce75', '#d22af8', '#278cf9', '#ff8b3c'];

	    for (let hex of hexs) {
	      let {
	        r,
	        g,
	        b
	      } = colorlib.hexToRgb(hex);
	      color = [...color, r / 255, g / 255, b / 255, 1];
	    }

	    this.color = color;
	  }

	  initGL() {
	    let gl = this.gl;
	    gl.getExtension('OES_standard_derivatives');
	    let vertexBuffer = gl.createBuffer();
	    let colorBuffer = gl.createBuffer();
	    let program = this.createProgram(vertexSrc, fragmentSrc);
	    let vertexPointer = gl.getAttribLocation(program, 'vertex');
	    let colorPointer = gl.getAttribLocation(program, 'color');
	    gl.useProgram(program);
	    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
	    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1, 1, -1, 1, 1, -1, -1, -1]), gl.STATIC_DRAW);
	    gl.vertexAttribPointer(vertexPointer, 2, gl.FLOAT, false, 0, 0);
	    gl.enableVertexAttribArray(vertexPointer);
	    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
	    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.color), gl.STATIC_DRAW);
	    gl.vertexAttribPointer(colorPointer, 4, gl.FLOAT, false, 0, 0);
	    gl.enableVertexAttribArray(colorPointer);
	    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
	    this.viewportPointer = gl.getUniformLocation(program, 'viewport');
	    this.anglePointer = gl.getUniformLocation(program, 'angle');
	    this.indentPointers = [gl.getUniformLocation(program, 'indent[0]'), gl.getUniformLocation(program, 'indent[1]')];
	    this.xx = 0;
	  }

	  flushUniforms() {
	    this.gl.uniform2fv(this.viewportPointer, [this.gl.drawingBufferWidth, this.gl.drawingBufferHeight]);
	    this.gl.uniform1f(this.anglePointer, this.angle);
	    this.gl.uniform4fv(this.indentPointers[0], this.indent[0]);
	    this.gl.uniform4fv(this.indentPointers[1], this.indent[1]);
	  }

	  render() {
	    this.angle = Math.PI * 0.9 + Math.sin(this.xx) * 0.1;
	    this.indent[0][0] = this.x1 + this.x2;
	    this.indent[1][0] = 1 - (this.x1 + this.x2); //this.indent[0][0] = 0.5 + 0.5 * Math.sin(this.xx)
	    //this.indent[1][0] = 0.5 - 0.5 * Math.sin(this.xx)

	    this.xx += 0.01;
	    this.flushUniforms();
	    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
	    requestAnimationFrame(() => this.render());
	  }

	  compileShader(type, source) {
	    let shader = this.gl.createShader(type);
	    this.gl.shaderSource(shader, source);
	    this.gl.compileShader(shader);

	    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
	      let log = this.gl.getShaderInfoLog(shader);
	      this.gl.deleteShader(shader);
	      throw new Error('failed to compile shader: ' + log);
	    }

	    return shader;
	  }

	  createProgram(vertex, fragment) {
	    let vertexShader = this.compileShader(this.gl.VERTEX_SHADER, vertex);
	    let fragmentShader = this.compileShader(this.gl.FRAGMENT_SHADER, fragment);
	    let program = this.gl.createProgram();
	    this.gl.attachShader(program, vertexShader);
	    this.gl.attachShader(program, fragmentShader);
	    this.gl.linkProgram(program);

	    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
	      throw new Error('failed to setup shader: ' + this.gl.getProgramInfoLog(program));
	    }

	    return program;
	  }

	}

	const vertexSrc = `
precision mediump float;

attribute vec2 vertex;
attribute vec4 color;

varying vec4 vColor;

void main() 
{
	gl_Position = vec4(vertex, 0, 1);
	vColor = color;
}
`;
	const fragmentSrc = `
#extension GL_OES_standard_derivatives : enable

precision mediump float;

uniform float angle;
uniform vec2 viewport;
uniform vec4 indent[2];

varying vec4 vColor;


float calcIndent(vec2 at, vec4 indent)
{
	float dist = distance(at, vec2(indent.x, indent.y * (viewport.y / viewport.x)));

	if(dist < indent.z){
		float inv = (indent.z - dist) / indent.z;

		return sign(inv) * pow(inv, 2.0) * indent.w;
	}else{
		return 0.0;
	}
}

float calcHeight(vec2 at, float angle)
{
	vec2 dir = vec2(sin(angle), cos(angle));
	vec2 perp = vec2(dir.y, -dir.x);
	vec2 point = perp * 3.0 + dir;
	vec2 aim = point - at;
	float h = abs(dot(perp, aim)) * 0.333;
	
	h += calcIndent(at, indent[0]);
	h += calcIndent(at, indent[1]);

	return h;
}


void main()
{
	vec2 uv = gl_FragCoord.xy/viewport.xx;
	float z = calcHeight(uv, angle) * 200.0;
	float contour = fract(z);
	
	if(mod(z, 2.0) > 1.0) 
		contour = 1.0 - contour;

	contour = contour/(fwidth(z) * 1.25);
	contour = smoothstep(1.0, 0.0, contour);
	
	gl_FragColor = vColor * contour;
}
`;

	var X = (node => {
	  return {
	    view: node => c("div", {
	      class: "x"
	    }, c("div", {
	      class: "cutout"
	    }), c(Contours, {
	      mode: "splash",
	      width: 200,
	      height: 156
	    }))
	  };
	});

	function EventEmitter(){
		this.listeners = [];
		this.dispatched = [];
	}

	EventEmitter.prototype.on = function(type,callback){
		var listener = {type:type,callback:callback};
		this.listeners.push(listener);
	};

	EventEmitter.prototype.once = function(type,callback){
		var listener = {type:type,callback:callback,once:true};
		this.listeners.push(listener);
	};

	EventEmitter.prototype.when = function(type,callback,keep){
		if(this.dispatched.indexOf(type)!=-1){
			callback();
			if(!keep)
				return
		}
		var listener = {type:type,callback:callback,once:!keep,when:true};
		this.listeners.push(listener);
	};

	EventEmitter.prototype.off = function(type,callback){
		for(var i in this.listeners){
			if(this.listeners[i].type==type){
				if(!callback || this.listeners[i].callback==callback)
					this.listeners.splice(i,1);
			}
		}
	};

	EventEmitter.prototype.emit = function(type,data){
		if(this.dispatched.indexOf(type)==-1)
			this.dispatched.push(type);

		for(var i=0;i<this.listeners.length;i++){
			if(i<0)
				continue
			if(this.listeners[i].type==type){
				this.listeners[i].callback.apply(null,Array.prototype.slice.call(arguments,1));
				if(this.listeners[i] && this.listeners[i].once){
					this.listeners.splice(i,1);
					i--;
				}
			}
		}
	};

	class Field extends EventEmitter{
		constructor(value, cfg){
			super();
			this.cfg = cfg || {};
			this.maxLength = this.cfg.maxLength;
			this.initial = value;
			this.value = value;
			this.validationCache = [];
			this.status = {};

			let vcfg = {};

			vcfg.input = this.cfg.input || (str => undefined);
			vcfg.change = this.cfg.change || (str => undefined);
			vcfg.submit = this.cfg.submit || (str => undefined);

			this.validate = {};
			this.validate.input = () => this.validateFunctions([vcfg.input]);
			this.validate.change = () => this.validateFunctions([vcfg.input, vcfg.change]);
			this.validate.submit = () => this.validateFunctions([vcfg.input, vcfg.change, vcfg.submit]);
		}

		setValue(v){
			let ov = this.value;

			this.value = v;

			if(v !== ov)
				this.emit('input');
		}

		reset(){
			this.setValue(this.initial);
		}

		validateFunctions(funcs){
			let token = Math.random().toString(16).slice(2);

			clearTimeout(this.waitTimeout);

			this.status.valid = false;
			this.status.issue = null;
			this.token = token;

			return funcs.reduce((promise, func, i) => {
				return promise
					.then(() => func(this.value))
					.then(() => {
						this.validationCache[i] = {input: this.value, issue: null};
					})
					.catch(issue => {
						this.validationCache[i] = {input: this.value, issue: issue};
						throw issue
					})

			}, Promise.resolve())
				.then(() => {
					if(token === this.token){
						this.status.issue = null;
						this.status.valid = true;
					}
				})
				.catch(issue => {
					if(token === this.token){
						this.status.issue = issue;
						this.status.valid = false;
					}
				})
				.then(() => {
					if(token === this.token){
						c.redraw();
					}
					c.redraw();
				})
		}

		getStatusTags(){
			let tags = [];

			if(this.status.issue)
				tags.push('issue');

			if(this.status.valid)
				tags.push('valid');

			return tags
		}
	}


	class Model extends BaseModel{
		constructor(ctx, fields){
			super();
			this.fields = {};
			this.status = {};

			let fieldDef = fields || Object.getPrototypeOf(this).constructor.fields;

			for(let [key, def] of Object.entries(fieldDef)){
				this.fields[key] = new Field(def.default || '', def);
				this.fields[key].key = key;
				this.fields[key].on('input', () => this.emit('input', key));

				Object.defineProperty(this, key, {
					get: () => this.fields[key].value,
					set: value => this.fields[key].setValue(value)
				});
			}

			this.on('input', () => {
				this.status.valid = false;
				this.status.issue = null;
			});
		}

		hasField(key){
			return !!this.fields[key]
		}

		getField(key){
			return this.fields[key]
		}

		reset(){
			Object.keys(this.fields).forEach(key => this.fields[key].reset());
		}

		async validate(fields){
			let allValid = true;

			await Promise.all(Object.keys(this.fields).map(async key => {
				if(fields && !fields.includes(key))
					return true

				await this.fields[key].validate.submit();

				if(!this.fields[key].status.valid)
					allValid = false;
			}));


			this.status.valid = allValid;
			
			if(!allValid)
				throw 'not all inputs are valid'
		}

		assign(data){
			if(!data)
				return

			Object.keys(data).forEach(key => {
				this.fields[key].setValue(data[key]);
			});
		}

		assignFieldStatus(fields){
			if(!fields)
				return

			for(let [key, status] of Object.entries(fields)){
				if(typeof status === 'string'){
					this.fields[key].status.issue = status;
				}else {
					Object.assign(this.fields[key].status, status);
				}
			}
		}

		data(){
			let data = {};

			Object.keys(this.fields).forEach(key => {
				data[key] = this.fields[key].value;
			});

			return data
		}
	}



	/*.then(() => {
		let cache = this.validationCache[i]

		if((!this.cfg || !this.cfg.disableCache) && cache && cache.input === this.value){
			if(cache.issue)
				throw cache.issue
			else
				return
		}

		let ret = func(this.value)

		if(typeof ret === 'object' && ret !== null){
			if(ret.wait){
				return new Promise(resolve => {
					this.waitTimeout = setTimeout(() => resolve(ret.query(this.value)), ret.wait)
				})
			}
		}	
	})*/

	var Form = node => {
		let submitting = false;
		let presentFields = [];

		async function submit(e){
			submitting = true;

			try{
				await node.attrs.model.validate(presentFields);

				node.attrs.model.status.submitting = true;

				if(node.attrs.action){
					await node.attrs.action.call(node.attrs.model, node.attrs.model.data());
				}else {
					await node.attrs.model.submit();
				}

				if(node.attrs.onsubmit){
					node.attrs.onsubmit();
				}
			}catch(e){
				node.attrs.model.status.valid = false;
				node.attrs.model.status.issue = e.message;
			}finally{
				submitting = false;
				node.attrs.model.status.submitting = false;
				node.ctx.redraw();
			}

			return false
		}

		return {
			view: node => {
				let model = node.attrs.model;
				let disabled = node.attrs.disabled || submitting;
				let children = node.children;

				presentFields = [];

				walkChildren(children, child => {
					if(child.tag === 'button'){
						if(!child.attrs.type)
							child.attrs.type = 'button';

						if(!child.attrs.hasOwnProperty('disabled')){
							child.attrs.disabled = disabled;
						}
					}

					if(child.attrs && child.attrs.field){
						if(!model.hasField(child.attrs.field)){
							console.warn(`missing field "${child.attrs.field}" in model`);
							return
						}

						let field = model.getField(child.attrs.field);

						if(child.tag === 'input' && child.attrs.type === 'checkbox'){
							child.attrs.checked = !!field.value;
							child.attrs.onchange = e => field.setValue(e.target.checked) & field.validate.change();
						}else {
							child.attrs[child.tag.valueKey || 'value'] = field.value;
							child.attrs.oninput = e => field.setValue(e.target.value) & field.validate.input();
							child.attrs.onchange = e => field.setValue(e.target.value) & field.validate.change();
							child.attrs.maxlength = field.maxLength;
						}
						

						if(child.attrs.className){
							child.attrs.className = child.attrs.className.replace('$status', field.getStatusTags().join(' '));
						}

						if(child.attrs.class){
							child.attrs.class = child.attrs.class.replace('$status', field.getStatusTags().join(' '));
						}
						
						if(child.attrs.onenter){
							child.attrs.onkeydown = e => ((e.keyCode === 13 && child.attrs.onenter()), true);
						}

						if(typeof child.tag === 'object')
							child.attrs.model = field;

						if(disabled){
							child.attrs.disabled = true;
						}

						presentFields.push(child.attrs.field);
					}else {
						if(typeof child.tag === 'object')
							child.attrs.model = model;
					}
				});

				return c(
					'form',
					{
						class: node.attrs.class,
						onsubmit: e => !disabled && submit() && false, 
					},
					children
				)
			}
		}
	};

	function walkChildren(children, func){
		if(!children)
			return

		for(let child of children){
			if(!child)
				continue
				
			func(child);
			walkChildren(child.children, func);
		}
	}

	var Status = {
		view: node => {
			let model = node.attrs.model;

			if(model.status.issue){
				return c('span.issue', model.status.issue)
			}
		}
	};

	var MaxLengthIndicator = {
		view: node =>{
			let model = node.attrs.model;

			if(model.value || !node.attrs.hideEmpty)
				return c('span.max', model.value.length + ' / ' + model.maxLength)
			else
				return c('span.max.empty')
		}
	};

	var Unlock = (node => {
	  let pass = new Model(null, {
	    passcode: {
	      submit: str => {
	        if (!str) throw 'required';
	      }
	    }
	  });

	  async function tryUnlock() {
	    if (await node.ctx.unlock(pass.passcode)) node.ctx.goto('/wallet/balances');
	  }

	  return {
	    oncreate: node => {
	      node.dom.querySelector('input').focus();
	    },
	    view: node => c(Form, {
	      class: "styled",
	      model: pass,
	      action: tryUnlock
	    }, c("section", {
	      class: "unlock"
	    }, c(X, null), c("h4", null, "Enter your passcode"), c("input", {
	      type: "password",
	      field: "passcode",
	      class: pass.status.issue ? 'issue' : ''
	    }), c(Status, null)), c("div", {
	      class: "foot"
	    }, c("button", {
	      type: "submit",
	      class: "styled primary",
	      disabled: !pass.passcode
	    }, c("span", null, "Unlock"))))
	  };
	});

	var NewWallet = (node => {
	  return {
	    view: node => c("section", {
	      class: "new-wallet"
	    }, c(X, null), c("a", {
	      href: "/new/import",
	      class: "button styled ghost"
	    }, c("span", null, "Import existing Wallet")), c("a", {
	      href: "/new/create",
	      class: "button styled ghost disabled"
	    }, c("span", null, "Create a new Wallet")))
	  };
	});

	var CreateWallet = (node => {});

	function isBase58(str){
		return /^[rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz]+$/.test(str)
	}

	var Return = {
	  view: node => c("a", {
	    class: "return",
	    href: node.attrs.href
	  }, c("i", {
	    class: "arrow-left"
	  }), c("span", null, node.attrs.label))
	};

	var ActivityIndicator = (node => {
	  let {
	    size
	  } = node.attrs;
	  let canvas;
	  let ctx;
	  let w;
	  let h;
	  let rays = 8;
	  let timeDivision = 150;

	  async function setup(c) {
	    canvas = c;
	    canvas.width = w = size * window.devicePixelRatio;
	    canvas.height = h = size * window.devicePixelRatio;
	    canvas.style.width = size + 'px';
	    canvas.style.height = size + 'px';
	    ctx = canvas.getContext('2d');
	    render();
	  }

	  function rayAt(a, r) {
	    return [(0.5 + Math.sin(a) * r * 0.5) * w, (0.5 - Math.cos(a) * r * 0.5) * h];
	  }

	  function render() {
	    if (!document.body.contains(canvas)) {
	      unload();
	      return;
	    }

	    let now = performance.now() + timeDivision * rays;
	    let t = now / timeDivision;
	    ctx.clearRect(0, 0, canvas.width, canvas.height);

	    for (let i = 0; i < rays; i++) {
	      let a = Math.PI * 2 / rays * i;
	      let x = (t - i) % rays / rays;
	      let o = 1 - Math.max(0, x);
	      ctx.beginPath();
	      ctx.strokeStyle = `rgba(77, 77, 77, ${o})`;
	      ctx.lineCap = 'round';
	      ctx.lineWidth = w * 0.11;
	      ctx.moveTo(...rayAt(a, 0.45));
	      ctx.lineTo(...rayAt(a, 0.9));
	      ctx.stroke();
	    }

	    requestAnimationFrame(render);
	  }

	  function unload() {
	    cancelAnimationFrame(render);
	  }

	  return {
	    oncreate: node => setup(node.dom),
	    onremove: node => unload(),
	    view: node => c("canvas", null)
	  };
	});

	var ImportWallet = (node => {
	  let state = node.ctx.pstate('new-wallet');
	  let wallet = new Model(null, {
	    seed: {
	      maxLength: 31,
	      input: async str => {
	        if (str && !isBase58(str)) throw 'This can not be a valid seed';

	        if (str.length === 31) {
	          try {
	            await node.ctx.deriveAddress(str);
	          } catch {
	            throw 'This seed is not valid';
	          }
	        }
	      }
	    }
	  });
	  state.wallet = {};
	  wallet.on('input', () => {
	    state.wallet = wallet.data();

	    if (wallet.seed.length === 31) {
	      node.ctx.deriveAddress(wallet.seed).then(address => state.wallet.address = address).then(node.ctx.redraw);
	    } else {
	      state.wallet.address = undefined;
	    }
	  });
	  wallet.assign(state.wallet);
	  return {
	    oncreate: node => {
	      node.dom.querySelector('textarea').focus();
	    },
	    view: node => c('[', null, c("section", {
	      class: "import-wallet"
	    }, c(Return, {
	      href: "/new",
	      label: "Create new wallet"
	    }), c("h4", null, "Enter the wallet seed to proceed"), c("span", null, "Your wallet seed will then be encrypted with a passcode of your choice and placed in your browser's storage."), c(Form, {
	      class: "styled",
	      model: wallet
	    }, c("textarea", {
	      field: "seed",
	      class: "$status"
	    }), c("div", {
	      class: "meta"
	    }, c(Status, {
	      field: "seed"
	    }), c(MaxLengthIndicator, {
	      field: "seed"
	    }))), state.wallet.address ? c('[', null, c(DerivedAccount, {
	      address: state.wallet.address
	    })) : null), c("div", {
	      class: "foot"
	    }, c("button", {
	      class: "styled primary",
	      disabled: !state.wallet.address,
	      onclick: () => node.ctx.goto('/new/passcode')
	    }, c("span", null, "Continue"))))
	  };
	});

	const DerivedAccount = node => {
	  let {
	    address
	  } = node.attrs;
	  let balance = null;
	  return {
	    oninit: async node => {
	      balance = parseInt(await node.ctx.getXrpBalance(address));
	    },
	    view: node => c("div", {
	      class: "account"
	    }, c("i", {
	      class: "user"
	    }), c("span", null, address), c("div", null, balance === null ? c('[', null, c(ActivityIndicator, {
	      size: 20
	    })) : balance > 0 ? c('[', null, c("span", null, balance, " XRP")) : c('[', null, c("span", null, "empty"))))
	  };
	};

	function laxHumanDuration(seconds){
		if(seconds < 1)
			return `less than a second`
		else if(seconds < 60)
			return `less than a minute`
		else if(seconds < 60 * 60)
			return `less than an hour`
		else if(seconds < 60 * 60 * 24)
			return `less than a day`
		else if(seconds < 60 * 60 * 24 * 7)
			return `less than a week`
		else if(seconds < 60 * 60 * 24 * 30 * 2)
			return `less than ${Math.ceil(seconds / (60 * 60 * 24 * 7))} weeks`
		else if(seconds < 60 * 60 * 24 * 365 * 2)
			return `about ${Math.ceil(seconds / (60 * 60 * 24 * 30))} months`
		else if(seconds < 60 * 60 * 24 * 365 * 1000)
			return `about ${Math.round(seconds / (60 * 60 * 24 * 365))} years`
		else
			return `over 1,000 years`
	}

	const bruteIterationsPerSecond = Math.pow(2, 28);

	function approximatePasswordCrackTime(password){
		let entropy = 0;

		if(/[a-z]/g.test(password))
			entropy += 25;

		if(/[A-Z]/g.test(password))
			entropy += 25;

		if(/[0-9]/g.test(password))
			entropy += 10;

		if(/[^a-zA-Z0-9]/g.test(password))
			entropy += 25;

		return Math.pow(entropy, password.length) / bruteIterationsPerSecond
	}

	var SetPasscode = (node => {
	  let state = node.ctx.pstate('new-wallet');
	  let approxCrackTime = null;
	  let deemedSafe = false;
	  let pass = new Model(null, {
	    passcode: {
	      submit: str => {
	        if (!str) throw 'required';
	      }
	    }
	  });
	  pass.assign({
	    passcode: state.passcode
	  });
	  pass.on('input', () => {
	    let time = approximatePasswordCrackTime(pass.passcode);

	    if (time > 0) {
	      approxCrackTime = laxHumanDuration(time);
	      deemedSafe = time > 60 * 60 * 24 * 365 * 250;
	    } else {
	      approxCrackTime = null;
	      deemedSafe = false;
	    }

	    state.passcode = pass.passcode;
	  });
	  return {
	    oncreate: node => {
	      node.dom.querySelector('input').focus();
	    },
	    view: node => c('[', null, c("section", {
	      class: "set-passcode"
	    }, c(Return, {
	      href: "/new/import",
	      label: "Change wallet seed"
	    }), c("h4", null, "Choose a passcode"), c("span", null, "Your wallet seed will be encrypted using this passcode."), c(Form, {
	      class: "styled",
	      model: pass
	    }, c("input", {
	      type: "password",
	      field: "passcode",
	      class: "$status"
	    }), approxCrackTime ? c('[', null, c("div", {
	      class: `infobox ${deemedSafe ? 'note' : 'warning'}`
	    }, c("span", null, "It would take ", approxCrackTime, " to crack this passcode"))) : null)), c("div", {
	      class: "foot"
	    }, c("button", {
	      class: "styled primary",
	      disabled: !pass.passcode,
	      onclick: () => node.ctx.goto('/new/passcode/confirm')
	    }, c("span", null, "Confirm"))))
	  };
	});

	var ConfirmPasscode = (node => {
	  let state = node.ctx.pstate('new-wallet');
	  let showPasscode = false;
	  let retype = false;
	  let repeat = new Model(null, {
	    passcode: {
	      input: str => {
	        if (str !== state.passcode) throw 'not identical';
	      }
	    }
	  });

	  function askReallyComplete() {
	    //later
	    complete();
	  }

	  function complete() {
	    node.ctx.addWallet(state);
	    node.ctx.goto('/wallet/balances');
	  }

	  return {
	    view: node => c('[', null, c("section", {
	      class: "confirm-passcode"
	    }, c(Return, {
	      href: "/new/passcode/",
	      label: "Change passcode"
	    }), c("h4", null, "Confirm your passcode"), c("span", null, "To make sure you haven't mistyped your passcode, choose one of the ways below."), showPasscode ? c('[', null, c("input", {
	      type: "text",
	      value: state.passcode,
	      readonly: true
	    }), c("span", null, "Review the passcode above, then click \"Complete\"")) : retype ? c('[', null, c("input", {
	      type: "password",
	      value: state.passcode,
	      readonly: true
	    }), c(Form, {
	      class: "styled",
	      model: repeat
	    }, c("input", {
	      type: "password",
	      field: "passcode",
	      class: "$status"
	    }), c(Status, {
	      field: "passcode"
	    })), c("span", null, "Re-type the passcode in the field above, then click \"Complete\"")) : c('[', null, c("input", {
	      type: "password",
	      value: state.passcode,
	      readonly: true
	    }), c("div", {
	      class: "options"
	    }, c("button", {
	      class: "styled ghost",
	      onclick: () => showPasscode = true
	    }, c("span", null, "\uD83D\uDC49 Show passcode")), c("button", {
	      class: "styled ghost",
	      onclick: () => retype = true
	    }, c("span", null, "\uD83D\uDC49 Re-type passcode"))))), c("div", {
	      class: "foot"
	    }, showPasscode || retype && repeat.passcode === state.passcode ? c('[', null, c("button", {
	      class: "styled primary",
	      onclick: complete
	    }, c("span", null, "Complete"))) : c('[', null, c("button", {
	      class: "styled secondary",
	      onclick: askReallyComplete
	    }, c("span", null, "Skip")))))
	  };
	});

	class App{
		constructor(container){
			this.init(container);
		}

		async init(container){
			this.state = await this.query({type: 'get-appstate'}) || {};

			console.log(JSON.stringify(this.state));

			c.route(container, '/new', {
				'/new': {view: node => c(NewWallet, {ctx: this})},
				'/new/create': {view: node => c(CreateWallet, {ctx: this})},
				'/new/import': {view: node => c(ImportWallet, {ctx: this})},
				'/new/passcode': {view: node => c(SetPasscode, {ctx: this})},
				'/new/passcode/confirm': {view: node => c(ConfirmPasscode, {ctx: this})},
				'/unlock': {view: node => c(Unlock, {ctx: this})},
				'/wallet': {view: node => c(Wallet, {ctx: this})},
				'/wallet/:section': {view: node => c(Wallet, {ctx: this, section: node.attrs.section})},
			});

			if(this.state.route){
				c.route.set(this.state.route);
			}else {
				if(await this.query({type: 'has-wallets'}))
					c.route.set('/unlock');
			}

			//wish I wouldn't have to do it this way, but I have no choice
			setInterval(() => this.syncState(), 100);
		}

		async addWallet(data){
			await this.query({type: 'add-wallet', ...data});
			await this.unlock(data.passcode);
		}

		async unlock(passcode){
			this.state.wallets = await this.query({type: 'get-wallets', passcode});
			this.state.passcode = passcode;
			this.state.account = this.state.wallets[0];

			return true
		}

		async requireBalances(){
			if(!this.account.balances){
				this.account.balances = await this.query({type: 'get-balances', address: this.account.address});
				this.redraw();
			}
		}

		getGroupedBalances(){
			let groups = [];

			for(let balance of this.account.balances){
				let group = groups.find(group => group[0].currency === balance.currency);

				if(!group){
					group = [balance];
					groups.push(group);
				}

				group.push(balance);
			}

			return groups
		}

		get account(){
			return this.state.account
		}

		redraw(){
			c.redraw();
		}

		goto(route){
			c.route.set(route);
		}

		pstate(key){
			if(key === 'route')
				throw 'reserved key'

			this.syncState();

			if(this.state[key])
				return this.state[key]

			return this.state[key] = {}
		}

		syncState(){
			this.state.route = c.route.get();
			this.query({type: 'set-appstate', state: this.state});
		}

		async deriveAddress(seed){
			return await this.query({type: 'derive-address', seed})
		}

		async getXrpBalance(address){
			return await this.query({type: 'get-xrp-balance', address})
		}

		async query(payload){
			return await new Promise((resolve, reject) => {
				chrome.extension.sendMessage(payload, response => {
					if(!response){
						reject(new Error('Internal error'));
						return
					}


					if(response.success)
						resolve(response.payload);
					else
						reject(response.error);
				});
			})
		}
	}

	new App(document.body);

})();
