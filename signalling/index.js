var express = require('express')
var app = express()
var http = require('http').createServer(app)
var io = require('socket.io')(http)
var url = require('url')

app.use(express.static('public'))

app.get('/', (req, res) => {
	res.sendFile(__dirname + '/public/index.html')
});

io.on('connection', (socket) => {
	var roomId = url.parse(socket.handshake.headers.referer, true).query.roomId

	socket.on('signal', (content) => {
		var recipient = content.recipient || roomId
		socket.to(recipient).emit('signal', {sender: socket.id, ...content})
	})
	
	socket.on('requestJoin', () => {		
		const room = io.sockets.adapter.rooms.get(roomId)
		socket.join(roomId)
		socket.to(roomId).emit('signal', {sender: socket.id, joined: true})
	})
	
	socket.on('disconnect', (reason) => {
		const content = {disconnected: true};
		socket.to(roomId).emit('signal', {sender: socket.id, ...content})
	});
})

http.listen(3000, () => {
	console.log('listening on *:3000')
})