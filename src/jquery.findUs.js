/*global
 jQuery, ymaps
 */
/** @namespace ymaps.Map*/
/** @namespace ymaps.Map.getBounds*/
/** @namespace ymaps.Map.setBounds*/
/** @namespace ymaps.route*/
/** @namespace ymaps.geocode*/
/** @namespace ymaps.Placemark*/
/** @namespace ymaps.setCenter*/
/** @namespace ymaps.geoObjects*/
/** @namespace ymaps.geoObjects.balloon*/
/** @namespace ymaps.geoObjects.geometry.getCoordinates*/
/** @namespace ymaps.coordSystem.geo.getDistance*/

;(function ($) {
	$.fn.findUs = (function () {
		'use strict';

		var APP = {
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
			loadScript: function (src, callback) {
				var head, script;
				head = document.getElementsByTagName('head')[0];
				script = document.createElement('script');
				if (typeof callback ===  'function') {
					script.onload = callback;
				}
				script.src = src;
				head.appendChild(script);
			},
			log: (function () {
				if (!window.console) {
					return function () {};
				}
				return function (msg, type) {
					type = typeof window.console[type] === 'function' ? type : 'log';
					return console[type](msg);
				}
			}()),
			throwError: function (msg) {
				throw new Error(msg);
			}
		};

		/**
		 *
		 * @param element {jQuery} jQuery element
		 * @param options {Object} Initial options
		 * @returns {FindUs} {Object} Instance
		 * @constructor
		 */
		var FindUs = function FindUs (element, options) {
			if (!(this instanceof FindUs)) {
				return new FindUs(element, options);
			}
			this.constructor = FindUs;
			this.mapContainerId = options.mapContainerId || null;
			this.$mapContainer = element;
			this.mapContainer = element[0];
			this.mapCenter = (APP._isArray(options.mapCenter) && (options.mapCenter.length === 2) && options.mapCenter) || APP.throwError('FindUs: missing map center coordinates');
			this.mapZoom = options.mapZoom || 10;

			this.packageLoaded = false;

			this.latitude  = 53.90109;
			this.longitude = 27.558759;
			this.defaultUserCoordinates = [53.90109, 27.558759];
			this.userPlacemarkCoordinates = [this.latitude, this.longitude];
			this.defaultCoordinatesReadable = 'Выбранное расположение отметки.';
			this.userCoordinatesReadable = this.defaultCoordinatesReadable; // will be replaced through ymaps.geocode on success result

			this.mapBehaviours = options.mapBehaviours || ['drag', 'dblClickZoom', 'multiTouch', 'rightMouseButtonMagnifier'];
			this.mapControls = options.mapControls || ['zoomControl'];

			this.boundCoordinatesZoomMargin = options.boundCoordinatesZoomMargin || 50;

			this.accuracy = 0;

			this.finalCoordinates = options.finalCoordinates || [53.906077, 27.554914];

			this.placemarks = (APP._isArray(options.placemarks) && options.placemarks) || [];
			this.placemarksObjects = {};

			this.canCreateRoute = false; // disabled until we show user placemark

			this.routes = [];

			this.userPlacemarkStyles = (APP._isObject(options.userPlacemark) && APP._isObject(options.userPlacemark.userPlacemarkStyles) && options.userPlacemark.userPlacemarkStyles) || {};

			this.createYandexMap();
		};

		/**
		 *
		 * @param callback {Function} Callback function when script is loaded
		 * @returns {boolean}
		 */
		FindUs.prototype.loadPackage = function (callback) {
			var self = this;
			if (self.packageLoaded) return true;
			APP.loadScript('http://api-maps.yandex.ru/2.1/?lang=ru_RU&load=package.full', function () {
				self.packageLoaded = true;
				typeof callback === 'function' && callback.call(self);
			});
		};

		/**
		 *
		 * @param options
		 * @returns {boolean}
		 */
		FindUs.prototype.createYandexMap = function (options) {
			var self = this;
			if (!self.packageLoaded) {
				return self.loadPackage(function () {
					self.createYandexMap.call(self, options)
				});
			}
			self.$mapContainer.trigger('onBeforeCreateYandexMap');
			ymaps.ready(function () {
				self.map = new ymaps.Map(self.mapContainer, {
					center: self.mapCenter,
					zoom: self.mapZoom,
					behaviors: self.mapBehaviours,
					controls: self.mapControls
				});
				self.createPlacemarks();
				self.$mapContainer.trigger('onAfterCreateYandexMap');
			});
		};

		/**
		 * Create placemarks on the map
		 */
		FindUs.prototype.createPlacemarks = function () {
			var self = this, placemarks, p, pLen, placemark, pmCoordinates, pmStyles, placemarkGeoObject,
				handlers, h, hLen, handler, handlerType, handlerFunction;
			self.$mapContainer.trigger('onBeforeCreatePlacemarks');
			if (!self.map) {
				APP.throwError('FindUs.createPlacemarks: you should create map before placing placemarks.');
			}
			placemarks = self.placemarks;
			if (placemarks.length) {
				for (p = 0, pLen = placemarks.length; p < pLen; p += 1) {
					placemark = placemarks[p];
					pmCoordinates = (APP._isArray(placemark.coordinates) && (placemark.coordinates.length === 2) && placemark.coordinates) || APP.throwError('FindUs: invalid coordinates of placemark - ' + APP._toString.call(placemark.coordinates));
					pmStyles = APP._isObject(placemark.placemarkStyles) && placemark.placemarkStyles;
					placemarkGeoObject = new ymaps.Placemark(pmCoordinates, {zIndex: 1000}, pmStyles);
					self.map.geoObjects.add(placemarkGeoObject);
					self.placemarksObjects['placemark' + p] = placemarkGeoObject;
					handlers = APP._isArray(placemark.handlers) && placemark.handlers;
					for (h = 0, hLen = handlers.length; h < hLen; h += 1) {
						handler = handlers[h];
						handlerType = handler.type || null;
						handlerFunction = handler.handler || null;
						handlerType && handlerFunction && placemarkGeoObject.events.add(handlerType, handlerFunction);
					}
				}
			}
			self.$mapContainer.trigger('onAfterCreatePlacemarks');
		};

		/**
		 * Try to get user coordinates.
		 * TODO: handle all possible errors and trigger appropriate events
		 */
		FindUs.prototype.getCurrentPosition = function () {
			var self = this;
			self.$mapContainer.trigger('onBeforeGetCurrentPosition');
			if (window.navigator && navigator.geolocation && typeof navigator.geolocation.getCurrentPosition === 'function') {
				navigator.geolocation.getCurrentPosition(function (data) {
					self.latitude  = data.coords.latitude;
					self.longitude = data.coords.longitude;
					self.userPlacemarkCoordinates = [self.latitude, self.longitude];
					self.accuracy  = +data.coords.accuracy;
					self.createUserPlacemarkAndSetBounds();
				}, function (positionError) {
					self.createUserPlacemarkAndSetBounds();
					self.map.setCenter(self.defaultUserCoordinates, 10);
					return APP.log('FindUs.getCurrentPosition: ' + positionError.code + ' ' + positionError.message, 'info');
				}, {
					enableHighAccuracy: true,
					timeout: 5000
				});
			} else {
				self.createUserPlacemarkAndSetBounds();
			}
		};

		/**
		 *
		 */
		FindUs.prototype.createUserPlacemarkAndSetBounds = function () {
			var self = this;
			self.createUserPlacemark();
		};

		/**
		 *
		 * @returns {boolean}
		 */
		FindUs.prototype.isDefaultUserCoordinates = function () {
			var self = this,
				defaultUserCoordinates = self.defaultUserCoordinates,
				userPlacemarkCoordinates = self.userPlacemarkCoordinates,
				i, iLen, status;
			if (!APP._isArray(userPlacemarkCoordinates)) {
				return true;
			}
			status = false;
			for (i = 0, iLen = userPlacemarkCoordinates.length; i < iLen; i += 1) {
				status = userPlacemarkCoordinates[i] === defaultUserCoordinates[i];
			}
			return status;
		};

		/**
		 *
		 */
		FindUs.prototype.createUserPlacemark = function () {
			var self = this;
			if (!window.ymaps) {
				setTimeout(function () {
					self.createUserPlacemark();
				}, 500);
				return;
			}
			self.userPlacemark = new ymaps.Placemark(self.userPlacemarkCoordinates, {
				balloonContent: '<div class="balloonAccuracyError">' +
				'<div class="balloonAccuracyErrorTop">Предполагаем,<br> что Вы здесь.</div>' +
				'<div class="balloonAccuracyErrorBottom">Переместите точку,<br> если мы ошиблись.</div>' +
				'</div>'
			}, self.userPlacemarkStyles);
			self.map.geoObjects.add(self.userPlacemark);
			self.userPlacemark.events.add('dragend', function () {
				self.userPlacemarkCoordinates = self.userPlacemark.geometry.getCoordinates();
				self.getReadableCoordinates(self.userPlacemarkCoordinates, self.defaultCoordinatesReadable, function (readableCoordinates) {
					self.userCoordinatesReadable = readableCoordinates;
				});
			});

			self.getReadableCoordinates(self.userPlacemarkCoordinates, self.defaultCoordinatesReadable, function (readableCoordinates) {
				self.userCoordinatesReadable = readableCoordinates;
			});

			if ((self.accuracy > 100 || self.isDefaultUserCoordinates()) && ($(window).width() > 767)) {
				self.showAccuracyInformer.call(self);
			}
			self.boundCoordinates();
			self.canCreateRoute = true;

			self.$mapContainer.trigger('onAfterCreateUserPlacemark');
		};

		/**
		 *
		 * @param coordinatesArray
		 * @param defaultValue
		 * @param callback
		 */
		FindUs.prototype.getReadableCoordinates = function (coordinatesArray, defaultValue, callback) {
			var output;
			ymaps.geocode(coordinatesArray)
				.then(function (result) {
					var readableCoordinates = null;
					try {
						readableCoordinates = result.geoObjects.get(0).properties.get('text');
					} catch (e) {
						readableCoordinates = defaultValue;
					}
					readableCoordinates && typeof callback === 'function' && callback(readableCoordinates);
					output = readableCoordinates;
					return output;
				});
		};

		/**
		 * Show info window upon users placemark
		 */
		FindUs.prototype.showAccuracyInformer = function () {
			var self = this;
			self.userPlacemark && self.userPlacemark.balloon && self.userPlacemark.balloon.open();
		};

		/**
		 * Fit markers into map
		 */
		FindUs.prototype.boundCoordinates = function () {
			var self = this, bounds;
			self.$mapContainer.trigger('onBeforeBoundCoordinates');
			bounds = self.map.geoObjects.getBounds();
			bounds && self.map.setBounds(bounds, {
				checkZoomRange: true,
				zoomMargin: self.boundCoordinatesZoomMargin
			});
			self.$mapContainer.trigger('onAfterBoundCoordinates');
		};

		/**
		 * Create route based on options passed
		 * @param options {Object} Initial data
		 * @param options.startPoint {Array|String} Start point
		 * @param options.throughPoints {Array} Points to create path through
		 * @param options.endPoint {Array|String} End point
		 * @param options.clearRoutes {Boolean} If we should clear previously created routes
		 * @param options.routeMode {String} Route mode (TODO)
		 */
		FindUs.prototype.createRoute = function (options) {

			var self = this,
				startPoint, throughPoints, t, tLen, tPoint, endPoint,
				pointsArray = [], routeMode;

			if (!self.canCreateRoute) return;

			self.$mapContainer.trigger('onBeforeCreateRoute');

			if (options.clearRoutes) {
				self.clearRoutes();
			}

			startPoint = APP._isArray(options.startPoint) || APP._isString(options.startPoint) ? options.startPoint : APP.throwError('FindUs.createRoute: invalid startPoint.');
			throughPoints = APP._isArray(options.throughPoints) ? options.throughPoints : [];
			endPoint = APP._isArray(options.endPoint) || APP._isString(options.endPoint) ? options.endPoint : APP.throwError('FindUs.createRoute: invalid endPoint.');

			pointsArray.push(startPoint);
			for (t = 0, tLen = throughPoints.length; t < tLen; t += 1) {
				tPoint = throughPoints[t];
				if (APP._isArray(tPoint) || APP._isString(tPoint)) {
					pointsArray.push(tPoint);
				}
			}
			pointsArray.push(endPoint);

			routeMode = APP._isString(options.routeMode) ? options.routeMode : 'auto';

			ymaps.route(pointsArray, {
					mapStateAutoApply: true,
					routingMode: routeMode,
					multiRoute: true
				})
				.done(function (multiRoute) {

					var routes, routesTotal, r, route, routeKey, routeDistance, routeTime,
						paths, pathsTotal, p, path,
						segments, segmentsTotal, s, segment, segmentProperties, segmentText,
						routesOutputData = {routes: {}, routesTotal: 0},
						segmentsOutput;

					self.map.geoObjects.add(multiRoute);
					self.routes.push(multiRoute);

					routes = multiRoute.getRoutes();
					routesTotal = routes.getLength();
					routesOutputData.routesTotal = routesTotal;
					for (r = 0; r < routesTotal; r += 1) {
						routeKey = 'route' + r;
						routesOutputData.routes[routeKey] = {
							routeIndex: r + 1, //prevent navigation link from showing 0 as "first"
							activeClass: r === 0 ? 'active' : '',
							routeMode: routeMode
						};
						route = routes.get(r);

						routeDistance = route.properties.get('distance').text || 0;
						routeTime = route.properties.get('duration').text || 0;

						paths = route.getPaths();
						pathsTotal = paths.getLength();
						routesOutputData.routes[routeKey]['segments'] = [];
						for (p = 0; p < pathsTotal; p += 1) {
							path = paths.get(p);
							segments = path.getSegments();
							segmentsTotal = segments.getLength();
							segmentsOutput = '';
							for (s = 0; s < segmentsTotal; s += 1) {
								segment = segments.get(s);
								segmentProperties = segment['properties'];
								segmentText = segmentProperties.get('text');

								routesOutputData.routes[routeKey]['segments'].push({
									text: segmentProperties.get('street') ? ' на ' + segmentProperties.get('street') : segmentProperties.get('text') || '',
									distance: segmentProperties.get('distance').text || '',
									duration: segmentProperties.get('duration').text || '',
									routeMode: routeMode
								});
							}
						}
					};

					self.$mapContainer.trigger('onAfterCreateRoute');
				}, function (error) {
					self.$mapContainer.trigger('onCreateRouteError');
				});
		};

		/**
		 * Clear previously created routes
		 */
		FindUs.prototype.clearRoutes = function () {
			var self = this, map, routes, r, rLen;
			map = self.map;
			routes = self.routes;
			for (r = 0, rLen = routes.length; r < rLen; r += 1) {
				map.geoObjects.remove(routes[r]);
			}
			self.$mapContainer.trigger('onAfterClearRoutes');
		}

		/**
		 * Get closest placemark
		 * @returns {*}
		 */
		FindUs.prototype.getClosestPlacemark = function () {
			var self = this, currentCoordinates, placemarks, p, placemark,
				finalCoordinates = null, shortestRouteLength = null, routeLength, shortestCoordinates = null;
			placemarks = self.placemarksObjects;
			currentCoordinates = self.userPlacemarkCoordinates;
			if (!APP._isArray(currentCoordinates) || currentCoordinates.length != 2) {
				return APP.log('FindUs.getClosestPlacemark: userPlacemark coordinates are invalid.', 'error');
			}
			for (p in placemarks) {
				if (placemarks.hasOwnProperty(p)) {
					placemark = placemarks[p];
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

		return function (options) {
			var _$element = this,
				findUs;
			findUs = new FindUs(_$element, options);
			_$element.data('findUs', findUs);
			return _$element;
		}
	}());
}(jQuery));

