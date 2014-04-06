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

	try {
		if (!this.providers[providerName]) {
			this.providers[providerName] = require('./providers/' + providerName).get(this);
		}
		this.providers[providerName][action].apply(this.providers[providerName], [ request, response, params ]);
	} catch (err) {
		console.error(err.stack);
		response.writeHead(500);
		response.end('Internal Server Error!');
	}
};

exports.create = function(options, providers){
	return new AdServer(options, providers);
};
