var os = require('os');
var url = require('url');
var http = require('http');
var querystring = require('querystring');

function AdServer(options, providers) {
	console.dir(providers);
	if(!providers){
		providers = {};
	}
	this.providers = providers;
	this.options = options;
	this.address = 'http://' + options.host + ':' + options.port;

	var This = this;
	http.createServer(function handler(request, response) {
		This.handleRequest(request, response);
	}).listen(options.port, options.host);
	console.log('Server running at ' + this.address);
}

AdServer.prototype.getProvider = function(providerName) {
	if (!this.providers[providerName]) {
		try {
			this.providers[providerName] = require('./providers/' + providerName).get(this);
		} catch (err) {
			console.error(err.stack);
			return null;
		}
	}
	return this.providers[providerName];
};

AdServer.prototype.handleRequest = function(request, response) {
	var urlInfo = url.parse(request.url);
	var pathParts = urlInfo.pathname.split('/');
	if (pathParts.length !== 3) {
		response.writeHead(404);
		response.end('Page not found!');
		return;
	}

	var providerName = pathParts[1].toLowerCase();
	var action = pathParts[2].toLowerCase();
	var params = querystring.parse(urlInfo.query);

	var provider = this.getProvider(providerName);
	if(!provider){
		response.writeHead(404);
		response.end('Service [' + providerName + '] not found!');
	}
	
	try {
		if(typeof provider[action] === 'function'){
			provider[action].apply(provider, [ request, response, params ]);
		}
		else{
			response.writeHead(404);
			response.end('Action [' + providerName + '.' + action + '] not found!');
		}
	} catch (err) {
		console.error(err.stack);
	}
};

exports.create = function(options, providers){
	return new AdServer(options, providers);
};
