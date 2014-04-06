/* jshint -W065 */

var os = require('os');
var VAST = require('vast-xml');
var xml2js = require('xml2js');

var kaltura = {
	client : require('../kaltura-client/KalturaClient')
};

function VastServer(adServer, config) {
	this.adServer = adServer;
	this.init(config);
}

VastServer.prototype.init = function(config) {
	this.pendingTasks = {};
	this.pendingRequests = [];

	this.initClient(config);
};

var KalturaLogger = {
	log : function(str) {
		console.log(str);
	}
};

VastServer.prototype.hasPendingTasks = function() {
	for ( var taskId in this.pendingTasks) {
		return true;
	}
	return false;
};

VastServer.prototype.startTask = function(callback) {
	if (typeof callback === 'function') {
		var taskId = Math.floor(Math.random() * 10000000000000001).toString(36);
		this.pendingTasks[taskId] = {
			counter : 1,
			callback : callback
		};
		return taskId;
	} else if (this.pendingTasks[callback]) {
		this.pendingTasks[callback].counter++;
		return callback;
	}
};

VastServer.prototype.commitTask = function(taskId) {
	if (this.pendingTasks[taskId]) {
		this.pendingTasks[taskId].counter--;
		if (this.pendingTasks[taskId].counter === 0) {
			this.pendingTasks[taskId].callback();
			delete this.pendingTasks[taskId];
		}
	}
};

VastServer.prototype.initClient = function(config) {
	console.log('Initializing client');
	var clientConfig = new kaltura.client.KalturaConfiguration(parseInt(config.partnerId));

	for ( var configKey in config) {
		clientConfig[configKey] = config[configKey];
	}

	clientConfig.setLogger(KalturaLogger);
	clientConfig.clientTag = 'ad-server-' + os.hostname();

	var This = this;
	var type = kaltura.client.enums.KalturaSessionType.ADMIN;
	this.sessionReady = false;
	this.client = new kaltura.client.KalturaClient(clientConfig);
	var taskId = this.startTask(function() {
		for (var i = 0; i < This.pendingRequests.length; i++) {
			This.pendingRequests[i]();
		}
		This.pendingRequests = [];
	});
	this.client.session.start(function(ks) {
		This.client.setKs(ks);
		This.listMetadataProfiles(taskId);
		This.commitTask(taskId);
	}, config.secret, config.userId, type, config.partnerId, config.expiry, config.privileges);
};

VastServer.prototype.listMetadataProfiles = function(taskId) {

	this.startTask(taskId);
	var filter = new kaltura.client.objects.KalturaMetadataProfileFilter();
	filter.systemNameIn = 'AdServer';

	var pager = new kaltura.client.objects.KalturaFilterPager();
	pager.pageSize = 1;

	var This = this;
	this.client.metadataProfile.listAction(function(list) {
		if (list.objectType === 'KalturaAPIException') {
			console.error('Client [metadataProfile.list][' + list.code + ']: ' + list.message);
			This.commitTask(taskId);
			return;
		}

		for (var i = 0; i < list.objects.length; i++) {
			var metadataProfile = list.objects[i];
			if (metadataProfile.systemName === 'AdServer') {
				This.entriesMetadataProfileId = metadataProfile.id;
			}
		}
		This.listInLineEntries(taskId);
		This.listWrapperEntries(taskId);
		This.commitTask(taskId);
	});
};

VastServer.prototype.listEntries = function(taskId, adType, callback) {
	var condition = new kaltura.client.objects.KalturaSearchCondition();
	condition.field = '/*[local-name()=\'metadata\']/*[local-name()=\'AdType\']';
	condition.value = adType;

	var filter = new kaltura.client.objects.KalturaMediaEntryFilter();
	filter.advancedSearch = new kaltura.client.objects.KalturaMetadataSearchItem();
	filter.advancedSearch.type = kaltura.client.enums.KalturaSearchOperatorType.SEARCH_AND;
	filter.advancedSearch.metadataProfileId = this.entriesMetadataProfileId;
	filter.advancedSearch.items = [ condition ];

	var pager = new kaltura.client.objects.KalturaFilterPager();
	pager.pageSize = 100;

	this.client.media.listAction(function(list) {
		callback(list, filter, pager);
	}, filter, pager);
};

VastServer.prototype.listInLineEntries = function(taskId) {
	var This = this;
	this.entries = {};
	this.startTask(taskId);
	this.listEntries(taskId, 'InLine', function(list, filter, pager) {
		This.handleMediaEntriesResponse(taskId, list, filter, pager);
		This.commitTask(taskId);
	});
};

VastServer.prototype.listWrapperEntries = function(taskId) {
	var This = this;
	this.wrappers = {};
	this.startTask(taskId);
	this.listEntries(taskId, 'Wrapper', function(list, filter, pager) {
		This.handleWrapperEntriesResponse(taskId, list, filter, pager);
		This.commitTask(taskId);
	});
};

VastServer.prototype.handleAssetsResponse = function(taskId, list, filter, pager) {
	if (list.objectType === 'KalturaAPIException') {
		console.error('Client [flavorAsset.list][' + list.code + ']: ' + list.message);
		return;
	}

	var This = this;
	if (list.objects.length === pager.pageSize) {
		pager.pageIndex++;
		this.startTask(taskId);
		this.client.flavorAsset.listAction(function(nextList) {
			This.handleAssetsResponse(taskId, nextList, filter, pager);
			This.commitTask(taskId);
		}, filter, pager);
	}

	for (var i = 0; i < list.objects.length; i++) {
		this.handleAsset(taskId, list.objects[i]);
	}
};

VastServer.prototype.handleAsset = function(taskId, asset) {
	if (this.entries[asset.entryId]) {
		this.entries[asset.entryId].assets[asset.id] = asset;
	}

	// fetch asset URL
	var This = this;
	this.startTask(taskId);
	this.client.flavorAsset.getUrl(function(assetUrl) {
		This.entries[asset.entryId].assets[asset.id].url = assetUrl;
		This.commitTask(taskId);
	}, asset.id);
};

VastServer.prototype.handleWrapperEntriesResponse = function(taskId, list, filter, pager) {
	if (list.objectType === 'KalturaAPIException') {
		console.error('Client [media.list][' + list.code + ']: ' + list.message);
		return;
	}

	var This = this;
	if (list.objects.length === pager.pageSize) {
		pager.pageIndex++;
		this.startTask(taskId);
		this.client.media.listAction(function(nextList) {
			This.handleWrapperEntriesResponse(taskId, nextList, filter, pager);
			This.commitTask(taskId);
		}, filter, pager);
	}

	var entryIds = [];
	for (var i = 0; i < list.objects.length; i++) {
		var entry = list.objects[i];
		this.wrappers[entry.id] = entry;
		entryIds.push(entry.id);
	}

	// fetch entries metadata
	var metadataFilter = new kaltura.client.objects.KalturaMetadataFilter();
	metadataFilter.metadataProfileIdEqual = this.entriesMetadataProfileId;
	metadataFilter.statusEqual = kaltura.client.enums.KalturaMetadataStatus.VALID;
	metadataFilter.metadataObjectTypeEqual = kaltura.client.enums.KalturaMetadataObjectType.ENTRY;
	metadataFilter.objectIdIn = entryIds.join(',');

	var metadataPager = new kaltura.client.objects.KalturaFilterPager();
	metadataPager.pageSize = 500;

	this.startTask(taskId);
	this.client.metadata.listAction(function(metadataList) {
		This.handleWrapperMetadataResponse(taskId, metadataList, metadataFilter, metadataPager);
		This.commitTask(taskId);
	}, metadataFilter, metadataPager);
};

VastServer.prototype.handleWrapperMetadataResponse = function(taskId, list, filter, pager) {
	if (list.objectType === 'KalturaAPIException') {
		console.error('Client [metadata.list][' + list.code + ']: ' + list.message);
		return;
	}

	var This = this;
	if (list.objects.length === pager.pageSize) {
		pager.pageIndex++;
		this.startTask(taskId);
		this.client.metadata.listAction(function(nextList) {
			This.handleWrapperMetadataResponse(taskId, nextList, filter, pager);
			This.commitTask(taskId);
		}, filter, pager);
	}

	for (var i = 0; i < list.objects.length; i++) {
		this.handleWrapperMetadata(list.objects[i]);
	}
};

VastServer.prototype.handleWrapperMetadata = function(metadata) {
	var This = this;
	xml2js.parseString(metadata.xml, function(err, data) {
		if (data.metadata) {
			for ( var field in data.metadata) {
				if (data.metadata[field].length === 1) {
					This.wrappers[metadata.objectId][field] = data.metadata[field].pop();
				}
			}
		}
	});
};

VastServer.prototype.handleMediaEntriesResponse = function(taskId, list, filter, pager) {

	if (list.objectType === 'KalturaAPIException') {
		console.error('Client [media.list][' + list.code + ']: ' + list.message);
		return;
	}

	var This = this;
	if (list.objects.length === pager.pageSize) {
		pager.pageIndex++;
		this.startTask(taskId);
		this.client.media.listAction(function(nextList) {
			This.handleMediaEntriesResponse(taskId, nextList, filter, pager);
			This.commitTask(taskId);
		}, filter, pager);
	}

	var entryIds = [];
	for (var i = 0; i < list.objects.length; i++) {
		var entry = list.objects[i];
		entryIds.push(entry.id);
		this.entries[entry.id] = entry;
		this.entries[entry.id].assets = {};
	}

	// fetch entries assets
	var assetsFilter = new kaltura.client.objects.KalturaFlavorAssetFilter();
	assetsFilter.statusEqual = kaltura.client.enums.KalturaFlavorAssetStatus.READY;
	assetsFilter.entryIdIn = entryIds.join(',');

	var assetsPager = new kaltura.client.objects.KalturaFilterPager();
	assetsPager.pageSize = 500;

	this.startTask(taskId);
	this.client.flavorAsset.listAction(function(assetsList) {
		This.handleAssetsResponse(taskId, assetsList, assetsFilter, assetsPager);
		This.commitTask(taskId);
	}, assetsFilter, assetsPager);

};

VastServer.prototype.attachWrappers = function(params, callback) {
	var This = this;
	var attachWrappersCallback = function() {
		var vast = new VAST();
		for ( var entryId in This.wrappers) {
			This.attachWrapper(This.wrappers[entryId], vast, params);
		}
		callback(vast);
	};

	if (this.hasPendingTasks()) {
		this.pendingRequests.push(attachWrappersCallback);
	} else {
		attachWrappersCallback();
	}
};

VastServer.prototype.attachAds = function(params, callback) {

	var This = this;
	var attachAdsCallback = function() {
		var vast = new VAST();
		for ( var entryId in This.entries) {
			This.attachEntry(This.entries[entryId], vast, params);
		}
		callback(vast);
	};

	if (this.hasPendingTasks()) {
		this.pendingRequests.push(attachAdsCallback);
	} else {
		attachAdsCallback();
	}
};

VastServer.prototype.formatDuration = function(duration) {
	var seconds = duration % 60;
	duration = (duration - seconds) / 60;
	var minutes = duration % 60;
	var hours = (duration - minutes) / 60;

	seconds = ('00' + seconds).slice(-2);
	minutes = ('00' + minutes).slice(-2);
	hours = ('00' + hours).slice(-2);
	return hours + ':' + minutes + ':' + seconds;
};

VastServer.prototype.attachAsset = function(asset, creative, params) {

	creative.attachMediaFile(asset.url, {
		id : asset.id,
		type : 'video/' + asset.fileExt,
		bitrate : asset.bitrate,
		minBitrate : asset.bitrate,
		maxBitrate : asset.bitrate,
		width : asset.width,
		height : asset.height,
		scalable : 'true',
		maintainAspectRatio : 'true',
		codec : asset.videoCodecId,
		apiFramework : 'VPAID'
	});
};

VastServer.prototype.attachWrapper = function(entry, vast, params) {
	var This = this;

	var ad = vast.attachAd({
		id : entry.id,
		structure : 'wrapper',
		VASTAdTagURI: entry.WrapperURI,
		AdSystem : {
			name : 'My Node Ad Server',
			version : '1.0'
		}
	});

	ad.attachImpression({
		id : 'started',
		url : This.adServer.address + '/report/start?id=' + entry.id
	});

	var creative = ad.attachCreative('CompanionAd', {
		width : entry.WrapperWidth,
		height : entry.WrapperHeight,
		CompanionClickThrough: This.adServer.address + '/report/CompanionClickThrough?id=' + entry.id,
		CompanionClickTracking: This.adServer.address + '/report/CompanionClickTracking?id=' + entry.id,
	});
	
	creative.attachResource('StaticResource', entry.thumbnailUrl, 'image/jpeg');
};

VastServer.prototype.attachEntry = function(entry, vast, params) {
	var This = this;

	var ad = vast.attachAd({
		id : entry.id,
		structure : 'inline',
		sequence : 1,
		AdTitle : entry.name,
		Description : entry.description,
		AdSystem : {
			name : 'My Node Ad Server',
			version : '1.0'
		}
	});

	ad.attachImpression({
		id : 'started',
		url : This.adServer.address + '/report/start?id=' + entry.id
	});

	var creative = ad.attachCreative('Linear', {
		AdParameters : '<xml></xml>',
		Duration : This.formatDuration(entry.duration)
	});

	for(var i = 0; i < VALID_TRACKING_EVENT_TYPES.length; i++){
		creative.attachTrackingEvent(VALID_TRACKING_EVENT_TYPES[i], This.adServer.address + '/report/' + VALID_TRACKING_EVENT_TYPES[i] + '?id=' + entry.id);
	}

	creative.attachVideoClick('ClickThrough', This.adServer.address + '/report/ClickThrough?id=' + entry.id, entry.id);
	creative.attachVideoClick('ClickTracking', This.adServer.address + '/report/ClickTracking?id=' + entry.id, entry.id);
	creative.attachVideoClick('CustomClick', This.adServer.address + '/report/CustomClick?id=' + entry.id, entry.id);

	for ( var assetId in entry.assets) {
		this.attachAsset(entry.assets[assetId], creative, params);
	}
};

VastServer.prototype.get = function(request, response, params) {

	this.attachAds(params, function(vast) {
		var xml = vast.xml({
			pretty : true,
			indent : '\t',
			newline : '\n'
		});

		response.writeHead(200, {
			'Content-Type' : 'application/xml'
		});
		response.end(xml);
	});
};

VastServer.prototype.wrap = function(request, response, params) {

	this.attachWrappers(params, function(vast) {
		var xml = vast.xml({
			pretty : true,
			indent : '\t',
			newline : '\n'
		});

		response.writeHead(200, {
			'Content-Type' : 'application/xml'
		});
		response.end(xml);
	});
};

exports.get = function(adServer) {
	return new VastServer(adServer, adServer.options);
};
