/**
 * jQuery findUs - Yandex map api 2
 *
 * @license MIT License; http://www.opensource.org/licenses/mit-license.php
 * @url   https://github.com/dashukin/jquery.findUs
 * @author  Vasili Molakhau <dashukin@gmail.com>
 * @version 0.2.0
 */
;(function ($) {

	var _helper, FindUs;

	_helper = {
		ge: function (id) {
			return document.getElementById(id);
		},
		_toString: Object.prototype.toString,
		_isObject: function (o) {
			return this._toString.call(o).slice(8, -1) === 'Object';
		},
		_isArray: function (o) {
			return this._toString.call(o).slice(8, -1) === 'Array';
		},
		_isString: function (s) {
			return typeof s === 'string';
		},
		_isFunction: function (f) {
			return typeof f === 'function';
		},
		_loadScript: function (src, callback) {
			var head, script;
			head = document.getElementsByTagName('head')[0];
			script = document.createElement('script');
			if (typeof callback ===  'function') {
				script.onload = callback;
			}
			script.src = src;
			head.appendChild(script);
		},
		_log: function (msg, type) {
			if (!window.console) return;
			type = type in console ? type : 'log';
			console[type](msg);
		},
		_throwError: function (msg) {
			throw new Error(msg);
		}
	};


	/**
	 *
	 * @param $element jQuery element to create map in
	 * @param options
	 * @return {FindUs}
	 * @constructor
	 */
	FindUs = function FindUs ($element, options) {
		if (!this instanceof FindUs) {
			return new FindUs($element, options);
		}

		var self = this,
			mapConfig,
			userConfig,
			placemarksConfig;

		self.$element = $element;
		self.element = $element[0];
		self.map = null;
		self.canCreateRoute = false;
		self.routes = [];
		self.routesInfo = [];
		self.showClosestRoute = false;
		self.routeMode = null;
		self.validRouteModes = {
			auto: true,
			masstransit: true
		};
		self.placemarks = [];

		options = options || {};
		!_helper._isObject(options.mapConfig) && (options.mapConfig = {});
		!_helper._isObject(options.userConfig) && (options.userConfig = {});
		!_helper._isObject(options.placemarksConfig) && (options.placemarksConfig = {});

		mapConfig = options.mapConfig;
		userConfig = options.userConfig;
		placemarksConfig = options.placemarksConfig;


		self._mapConfig = {
			lang: mapConfig['lang'] || 'ru_RU',
			version: mapConfig['version'] || 2.1,
			package: mapConfig['package'] || 'package.full',
			controls: mapConfig['controls'] || ['zoomControl'],
			behaviours: mapConfig['behaviours'] || ['drag', 'dblClickZoom', 'multiTouch', 'rightMouseButtonMagnifier'],
			center: _helper._isArray(mapConfig['center']) && mapConfig['center'].length === 2 ? mapConfig['center'] : [44.63, 28.77],
			zoom: mapConfig['zoom'] || 10
		};

		self._userConfig = {
			processUserCoordinates: !!userConfig['processUserCoordinates'] || false,
			balloonContent: userConfig['balloonContent'] || '',
			placemarkStyles: userConfig['placemarkStyles'] || {},
			placemark: null
		};

		self._placemarksConfig = {
			placemarks: placemarksConfig.placemarks,
			placemarksStyles: placemarksConfig.placemarksStyles,
			_placemarks: {}
		};

		self.createMap(self._mapConfig, function () {
			self._placemarksConfig.placemarks.length && self.createPlacemarks();
			self._userConfig.processUserCoordinates && self.getUserCoordinates();
		});

	};

	/**
	 *
	 * @param callback Function to be called after package has been loaded
	 */
	FindUs.prototype.loadPackage = function (callback) {
		var self = this;
		if (self.packageLoaded) return;
		_helper._loadScript('http://api-maps.yandex.ru/' + self._mapConfig.version + '/?lang=' + self._mapConfig.lang + '&load=' + self._mapConfig.package, function () {
			self.packageLoaded = true;
			typeof callback === 'function' && callback.call(self);
		});
	};

	/**
	 *
	 * @param {Object} options Object data to create map
	 * @returns {*}
	 */
	FindUs.prototype.createMap = function (options, callback) {
		var self = this,
			_args = arguments;
		if (!self.packageLoaded) {
			return self.loadPackage(function () {
				self.createMap.apply(self, _args);
			});
		}
		self.$element.trigger('beforeMapCreated');
		ymaps.ready(function () {
			self.map = new ymaps.Map(self.element, options);
			self.$element.trigger('mapCreated');
			_helper._isFunction(callback) && callback.call(self);
		});
	};

	/**
	 *
	 */
	FindUs.prototype.getUserCoordinates = function () {
		var self = this;
		self.$element.trigger('beforeGetUserCoordinates');
		if (window.navigator && navigator.geolocation && _helper._isFunction(navigator.geolocation.getCurrentPosition)) {
			navigator.geolocation.getCurrentPosition(function (data) {
				self.$element.trigger('userCoordinatesRetrieved');
				self._userConfig.coordinates = [data.coords.latitude, data.coords.longitude];
				self._userConfig.accuracy  = +data.coords.accuracy;
				self.createUserPlacemark();
			}, function (error) {
				self.$element.trigger('userCoordinatesFailed', error.code, error.message);
				self.createUserPlacemark();
				self.map.setCenter(self._mapConfig.center, 10);
				_helper._log('FindUs.getUserCoordinates: ' + error.code + ' ' + error.message, 'warn');
			}, {
				enableHighAccuracy: true,
				timeout: 5000
			});
		} else {
			self.$element.trigger('navigatorError');
			self.createUserPlacemark();
			_helper._log('FindUs.getUserCoordinates: your browser does not support geolocation.', 'warn');
		}
	};

	/**
	 *
	 */
	FindUs.prototype.createUserPlacemark = function () {
		var self = this;
		if (self._userConfig.placemark !== null) {
			self._userConfig.placemark.geometry.setCoordinates(self._userConfig.coordinates);
			return;
		}
		self._userConfig.placemark = new ymaps.Placemark(self._userConfig.coordinates, {
			balloonContent: self._userConfig.balloonContent
		}, self._userConfig.placemarkStyles);
		self.map.geoObjects.add(self._userConfig.placemark);
		self._userConfig.placemark.events.add('dragend', function () {
			self._userConfig.coordinates = self._userConfig.placemark.geometry.getCoordinates();
		});

		if (self._userConfig.accuracy > 100 || self.isDefaultCoordinates()) {
			self.showAccuracyInformer.call(self);
		}
		self.boundCoordinates();
		self.canCreateRoute = true;
		self.$element.trigger('userPlacemarkCreated');
	};

	/**
	 *
	 */
	FindUs.prototype.boundCoordinates = function () {
		var self = this, bounds;
		self.$element.trigger('beforeBoundCoordinates');
		bounds = self.map.geoObjects.getBounds();
		bounds && self.map.setBounds(bounds, {
			checkZoomRange: true,
			zoomMargin: self.boundCoordinatesZoomMargin
		});
		self.$element.trigger('boundCoordinates');
	};

	FindUs.prototype.isDefaultCoordinates = function () {
		var self = this,
			defaultCoords = self._mapConfig.center,
			userCoords = self._userConfig.coordinates;

		if (!_helper._isArray(userCoords) || (defaultCoords[0] === userCoords[0]) && (defaultCoords[1] === userCoords[1])) {
			return true;
		}
		return false;
	};

	FindUs.prototype.showAccuracyInformer = function () {
		var self = this;
		self._userConfig && self._userConfig.placemark && self._userConfig.placemark.balloon && self._userConfig.placemark.balloon.open();
	};

	FindUs.prototype.createPlacemarks = function () {
		var self = this, placemarks, p, pLen, placemark, pmCoordinates, pmStyles, placemarkGeoObject,
			handlers, h, hLen, handler, handlerType, handlerFunction;
		self.$element.trigger('beforePlacemarksCreated');

		self.clusterer = new ymaps.Clusterer({
			preset: 'islands#invertedNightClusterIcons',
			groupByCoordinates: false,
			gridSize: 20,
			clusterDisableClickZoom: true,
			clusterHideIconOnBalloonOpen: false,
			geoObjectHideIconOnBalloonOpen: false
		});

		placemarks = self._placemarksConfig.placemarks;
		if (placemarks.length) {
			for (p = 0, pLen = placemarks.length; p < pLen; p += 1) {
				placemark = placemarks[p];
				pmCoordinates = (_helper._isArray(placemark.coordinates) && (placemark.coordinates.length === 2) && placemark.coordinates) || _helper._throwError('FindUs: invalid coordinates of placemark - ' + _helper._toString.call(placemark.coordinates));
				pmStyles = _helper._isObject(placemark.placemarkStyles) && $.extend({}, self._placemarksConfig.placemarksStyles, placemark.placemarkStyles);
				console.log(placemark);
				placemarkGeoObject = new ymaps.Placemark(pmCoordinates, {
					zIndex: 1000,
					balloonContent: _helper._isString(placemark.balloonContent) ? placemark.balloonContent : null,
					clusterCaption: placemark.placemarkData['categoryName'],
					balloonContentBody: _helper._isString(placemark.balloonContent) ? placemark.balloonContent : null
				}, pmStyles);

				self.placemarks.push(placemarkGeoObject);
				self.map.geoObjects.add(placemarkGeoObject);
				self._placemarksConfig._placemarks['placemark' + p] = placemarkGeoObject;

				placemarkGeoObject.placemarkData = placemark.placemarkData || {};

				handlers = _helper._isArray(placemark.handlers) && placemark.handlers;
				for (h = 0, hLen = handlers.length; h < hLen; h += 1) {
					handler = handlers[h];
					handlerType = handler.type || null;
					handlerFunction = handler.handler || null;
					handlerType && handlerFunction && placemarkGeoObject.events.add(handlerType, handlerFunction);
				}
			}
		}

		if (self.placemarks.length) {
			self.clusterer.add(self.placemarks);
			self.map.geoObjects.add(self.clusterer);
		}


		self.$element.trigger('onAfterCreatePlacemarks');
	};

	FindUs.prototype.getCurrentUserCoordinates = function () {
		var self = this;
		return self._userConfig.coordinates;
	};


	FindUs.prototype.createRoute = function (options) {

		var self = this,
			startPoint, throughPoints, t, tLen, tPoint, endPoint,
			pointsArray = [], routeMode;

		if (!self.canCreateRoute) return;

		if (options.clearRoutes) {
			self.clearRoutes();
		}

		self.$element.trigger('beforeRouteCreated');

		startPoint = _helper._isArray(options.from) || _helper._isString(options.from) ? options.from : _helper._throwError('FindUs.createRoute: invalid startPoint.');
		throughPoints = _helper._isArray(options.through) ? options.through : [];
		endPoint = _helper._isArray(options.to) || _helper._isString(options.to) ? options.to : _helper._throwError('FindUs.createRoute: invalid endPoint.');

		pointsArray.push(startPoint);
		for (t = 0, tLen = throughPoints.length; t < tLen; t += 1) {
			tPoint = throughPoints[t];
			if (_helper._isArray(tPoint) || _helper._isString(tPoint)) {
				pointsArray.push(tPoint);
			}
		}
		pointsArray.push(endPoint);

		self.routeMode = self.validateRouteModes(options.routeMode);

		ymaps.route(pointsArray, {
				mapStateAutoApply: true,
				routingMode: self.routeMode,
				multiRoute: true
			})
			.done(function (multiRoute) {

				var routes, routesTotal, r, route, routeKey, routeData,
					paths, pathsTotal, p, path,
					segments, segmentsTotal, s, segment, segmentProperties, segmentText,
					routesOutputData = {routes: {}, routesTotal: 0},
					segmentsOutput;

				self.map.geoObjects.add(multiRoute);
				self.routes.push(multiRoute);

				routes = multiRoute.getRoutes();
				routesTotal = routes.getLength();
				routesOutputData.routesTotal = routesTotal; // remove?
				for (r = 0; r < routesTotal; r += 1) {
					routeKey = 'route' + r;
					routeData = {
						routeIndex: r + 1, //prevent navigation link from showing 0 as "first"
						activeClass: r === 0 ? 'active' : '',
						routeMode: self.routeMode,
						segments: []
					}

					route = routes.get(r);

					routeData.distance = route.properties.get('distance').text || 0;
					routeData.duration = route.properties.get('duration').text || 0;

					paths = route.getPaths();
					pathsTotal = paths.getLength();
					for (p = 0; p < pathsTotal; p += 1) {
						path = paths.get(p);
						segments = path.getSegments();
						segmentsTotal = segments.getLength();
						segmentsOutput = '';
						for (s = 0; s < segmentsTotal; s += 1) {
							segment = segments.get(s);
							segmentProperties = segment['properties'];
							segmentText = segmentProperties.get('text');

							routeData.segments.push({
								text: segmentProperties.get('street') ? segmentProperties.get('street') : segmentProperties.get('text') || '',
								distance: segmentProperties.get('distance').text || '',
								duration: segmentProperties.get('duration').text || '',
								routeMode: self.routeMode
							});
						}
					}
					self.routesInfo.push(routeData);
				};

				self.$element.trigger('routeCreated');
			}, function (error) {
				self.$element.trigger('routeError');
			});
	};


	FindUs.prototype.clearRoutes = function () {
		var self = this, map, routes, r, rLen;

		self.$element.trigger('beforeRoutesCleared');
		map = self.map;
		routes = self.routes;
		for (r = 0, rLen = routes.length; r < rLen; r += 1) {
			map.geoObjects.remove(routes[r]);
		}
		self.showClosestRoute = false;
		self.$element.trigger('routesCleared');
	};

	FindUs.prototype.getClosestPlacemark = function () {
		var self = this, currentCoordinates, placemarks, p, placemark,
			finalCoordinates = null, shortestRouteLength = null, routeLength, shortestCoordinates = null;

		placemarks = self._placemarksConfig._placemarks;
		currentCoordinates = self._userConfig.coordinates;
		if (!_helper._isArray(currentCoordinates) || currentCoordinates.length !== 2) {
			return _helper._log('FindUs.getClosestPlacemark: userPlacemark coordinates are invalid.', 'warn');
		}
		for (p in placemarks) {
			if (placemarks.hasOwnProperty(p)) {
				placemark = placemarks[p];
				if (placemark.options.get('visible') === false) continue;
				finalCoordinates = placemark.geometry.getCoordinates();
				routeLength = ymaps.coordSystem.geo.getDistance(currentCoordinates, finalCoordinates);
				routeLength = routeLength.toFixed(4) * 1000;
				if (!shortestRouteLength || routeLength < shortestRouteLength) {
					shortestRouteLength = routeLength;
					shortestCoordinates = finalCoordinates;
				}
			}
		}
		return shortestCoordinates;
	};

	/**
	 *
	 * @param f function to be called for each placemarks.
	 * Should return true to make palcemark visible. Otherwise false.
	 */
	FindUs.prototype.filterPlacemarks = function (f, clearRoutes) {
		if (typeof f !== 'function') return;

		var self = this,
			placemarks = self._placemarksConfig._placemarks,
			p, placemark, shouldBeVisible;

		self.$element.trigger('beforePlacemarksFiltered');

		for (p in placemarks) {
			if (placemarks.hasOwnProperty(p)) {
				placemark = placemarks[p];
				shouldBeVisible = !!f.call(null, placemark, placemark.placemarkData);
				if (shouldBeVisible) {
					self.clusterer.add(placemark);
				} else {
					self.clusterer.remove(placemark);
				}
				placemark.options.set('visible', shouldBeVisible);
			}
		}

		self.$element.trigger('placemarksFiltered');

		if (!!clearRoutes) {
			self.clearRoutes();
		} else if (self.showClosestRoute === true) {
			self.getClosestRoute({
				from: self.getCurrentUserCoordinates(),
				to: self.getClosestPlacemark(),
				routeMode: self.routeMode
			});
		}
	};

	FindUs.prototype.getClosestRoute = function (options) {
		var self = this,
			routeMode,
			clearRoutes;

		self.$element.trigger('beforeClosestRouteRetrieved');

		options = options || {};
		self.validateRouteModes(options.routeMode);
		clearRoutes = typeof options.clearRoutes !== 'undefined' ? !!options.clearRoutes : true;

		self.showClosestRoute = true;
		self.createRoute({
			from: self.getCurrentUserCoordinates(),
			to: self.getClosestPlacemark(),
			routeMode: routeMode || self.routeMode,
			clearRoutes: clearRoutes
		});

		self.$element.trigger('closestRouteRetrieved');

	};

	FindUs.prototype.validateRouteModes = function (routeMode) {
		var self = this,
			validRouteModes = self.validRouteModes;
		return (validRouteModes.hasOwnProperty(routeMode) && (validRouteModes[routeMode] === true) && routeMode) || 'auto';
	};


	$.fn.findUs = function (options) {
		var _$element = $(this);
		_$element.data('findUs', new FindUs(_$element, options));
		return _$element;

	};

}(jQuery));