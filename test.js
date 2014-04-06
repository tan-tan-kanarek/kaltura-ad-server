var server = require('./server');

var providers = {
	report: {
		test: function(request, response, params){
			response.writeHead(200, {
				'Content-Type' : 'text/html'
			});
			response.end('OK');
		}
	}
};

// create new account at http://corp.kaltura.com/free-trial
var options = {
	host: '127.0.0.1',
	port: 8085,
	partnerId : /* must fill in */,
	secret : /* must fill in */,
	userId : 'ad-server',
	expiry : null,
	privileges : null
	// serviceUrl: 'http://www.kaltura.com'
};

var adServer = server.create(options, providers);
