// variables
const localStream = new MediaStream();
const socket = io();
const peers = new Map();

let audioEnabled = true;
let videoEnabled = true;
let presenting = false;

const CONFIG = {
	IDS: {
		LOCAL_VIDEO: 'localVideo',
		AUDIO_SELECT: 'audioSelect',
		VIDEO_SELECT: 'videoSelect',
		VIDEO_CONTAINER: 'videoContainer',
		TOGGLE_AUDIO: 'muteBtn',
		TOGGLE_VIDEO: 'cameraBtn',
		LEAVE: 'leaveBtn',
		PRESENT: 'shareBtn'
	},
	URLS: {
		EXIT: '/lobby'
	},
	CSS: {
		HIDE: 'd-none',
		COLS: '--cols',
	},
	FILES: {
		LOADING_GIF: 'loading.gif'
	},
	CONNECTION_CONFIG: {
		iceServers: [{'urls': 'stun:stun.l.google.com:19302'}]
	}
}

class Peer {
	constructor(id, stream) {        
		this.id = id;
		this.stream = new MediaStream();        
		this.connection = new RTCPeerConnection(CONFIG.CONNECTION_CONFIG);
		this.isPresenting = false;
		
		// Listen for local ICE candidates
		this.connection.addEventListener('icecandidate', (event) => {
			if (event.candidate) {
				socket.emit('signal', {iceCandidate: event.candidate, recipient: this.id});
			}
		});
		
		// Handle renegotiation
		this.connection.addEventListener('negotiationneeded', () => {
			this.sendOffer();
		});

		// Add remote tracks
		this.connection.addEventListener('track', async (event) => {
			if (event.track.kind === 'video') {
				this.stream.getVideoTracks().forEach(track => this.stream.removeTrack(track));
			}
			this.stream.addTrack(event.track);
		});
		
		// Add local tracks
		stream.getTracks().forEach(track => {
			this.connection.addTrack(track);
		});
		
		// Add video element to DOM
		const videoElement = document.createElement('video');
		videoElement.poster = CONFIG.FILES.LOADING_GIF;
		videoElement.autoplay = true;
		videoElement.srcObject = this.stream;
		videoElement.id = 'video_' + this.id;
		$('#' + CONFIG.IDS.VIDEO_CONTAINER).append(videoElement);        
	}
	
	async sendOffer() {
		const offer = await this.connection.createOffer();
		await this.connection.setLocalDescription(offer);
		socket.emit('signal', {offer, recipient: this.id});
	}
	
	async sendAnswer(offer) {
		this.connection.setRemoteDescription(
			new RTCSessionDescription(offer)
		);
		const answer = await this.connection.createAnswer();
		await this.connection.setLocalDescription(answer);
		socket.emit('signal', {answer, recipient: this.id});
	}
	
	async handleAnswer(answer) {
		try {
			const remoteDesc = new RTCSessionDescription(answer);
			await this.connection.setRemoteDescription(remoteDesc);
		} catch (e) {
			console.log(e);
			console.log(this);
			console.log(answer);
		}		
	}
	
	async handleCandidate(candidate) {
		await this.connection.addIceCandidate(candidate);
	}
	
	disconnect() {
		this.connection.close();
		this.connection = null;     
		// Remove video element from DOM
		const videoElement = $('#video_' + this.id);
		videoElement.remove();
	}
}

// event listeners
$('.toggleBtn').click(function(){
	$( this ).children().toggleClass(CONFIG.CSS.HIDE);
});

$('#' + CONFIG.IDS.AUDIO_SELECT).on('change', function(){
	getMedia(localStream);
});

$('#' + CONFIG.IDS.VIDEO_SELECT).on('change', function(){
	getMedia(localStream);
});

$('#' + CONFIG.IDS.LEAVE).on('click', function(){
	window.location.href = CONFIG.URLS.EXIT;
});

$('#' + CONFIG.IDS.TOGGLE_VIDEO).click(toggleVideo);
$('#' + CONFIG.IDS.TOGGLE_AUDIO).click(toggleAudio);

navigator.mediaDevices.addEventListener('devicechange', updateDeviceLists);

$('#' + CONFIG.IDS.PRESENT).click(async function(e){
	const canPresent = [...peers]
		.filter(peer => peer.isPresenting === true).length === 0;
	
	if (presenting) {
		presenting = false;
		$( this ).children().toggleClass(CONFIG.CSS.HIDE);
		await stopShare(localStream);
	} 
	else if (!presenting && canPresent) 
	{
		try {
			startShare(localStream).then(() => {
				presenting = true;
				$( this ).children().toggleClass(CONFIG.CSS.HIDE);
			});			
		} catch(e) {
			// the user cancelled the operation
		}
	}
});

const observer = new MutationObserver(setColumnCount);
window.onresize = setColumnCount;

// Firefox blocks autoplay and prevents .play() outside of click event handlers
window.addEventListener('click', () => document.querySelectorAll('video').forEach(el => el.play()));

window.addEventListener('focus', () => {
	console.log(document.querySelectorAll('video'));
	document.querySelectorAll('video').forEach(video => video.play());
});

// functions
function init() {
	$('#' + CONFIG.IDS.LOCAL_VIDEO).prop('srcObject', localStream);
	
	updateDeviceLists()
		.then(() => getMedia(localStream))
		.then(() => configureSocket())
		.then(() => {
			socket.emit('requestJoin');
			setColumnCount();
		});
		
}

async function startShare(stream) {
	const constraints = {
		'video': {
			cursor: 'always',
			displaySurface: 'window'
		},
		'audio': true
	};
	
	const newStream = await navigator.mediaDevices.getDisplayMedia(constraints);
	
	// change local video to presentation
	stream.getVideoTracks().forEach(track => stream.removeTrack(track));
	newStream.getTracks().forEach(track => stream.addTrack(track));
	
	// change peer videos to presentation
	peers.forEach(peer => {
		peer.connection.getSenders()
			.filter(sender => sender.track.kind === 'video')
			.forEach(sender => peer.connection.removeTrack(sender));
		newStream.getTracks().forEach(track => peer.connection.addTrack(track));		
	});
	
	socket.emit('signal', {isPresenting: true});
}

async function stopShare(stream) {
	await getMedia(stream);
	
	peers.forEach(peer => {
		peer.connection.getSenders()
			.forEach(sender => peer.connection.removeTrack(sender));
		stream.getTracks().forEach(track => peer.connection.addTrack(track));
	});
	
	socket.emit('signal', {isPresenting: false});
}

async function updateDeviceLists() {
	const updateSelect = async (deviceKind, elementId) => {
		const devices = await navigator.mediaDevices.enumerateDevices();
		const element = $('#' + elementId);     
		const options = devices.filter(device => device.kind === deviceKind)
			.map(device => {'<option value=>'
				const label = device.label || '(No name found)';
				const value = device.groupId ?? device.deviceId;
				return `<option value=${value}>${label}</option>`;
			});
		element.html(options.join(' '));
	}; 
	await updateSelect('audioinput', CONFIG.IDS.AUDIO_SELECT);
	await updateSelect('videoinput', CONFIG.IDS.VIDEO_SELECT);
}

async function getMedia(stream) {
	const audioId = $('#' + CONFIG.IDS.AUDIO_SELECT).val();
	const videoId = $('#' + CONFIG.IDS.VIDEO_SELECT).val();
	
	const constraints = {
		video: {deviceId: videoId, groupId: videoId},
		audio: {deviceId: audioId, groupId: audioId}
	}
	const newStream = await navigator.mediaDevices.getUserMedia(constraints);
	
	stream.getVideoTracks().forEach(track => {
		if (!newStream.getTracks().includes(track)) {
			stream.removeTrack(track);
		}
	});
	
	newStream.getTracks().forEach(track => stream.addTrack(track));
}

async function setAudioDevice(deviceId, stream) {
	const constraints = {
		video: false, 
		audio: {deviceId, groupId: deviceId }
	};
	const newStream = await getUserMediaStream(constraints);
	stream.getAudioTracks().forEach(track => stream.removeTrack(track));
	newStream.getAudioTracks().forEach(track => stream.addTrack(track));
}

async function setVideoDevice(deviceId, stream) {
	const constraints = {
		video: {deviceId, groupId: deviceId },
		audio: false
	};
	const newStream = await getUserMediaStream(constraints);
	stream.getVideoTracks().forEach(track => stream.removeTrack(track));
	newStream.getVideoTracks().forEach(track => stream.addTrack(track));
}

function toggleAudio() {    
	audioEnabled = !audioEnabled;
	localStream.getAudioTracks().forEach(track => track.enabled = audioEnabled);
}

function toggleVideo() {
	videoEnabled = !videoEnabled;
	localStream.getVideoTracks().forEach(track => track.enabled = videoEnabled);
}

function setColumnCount() {
	let i;
	let j;
	let cols = 1;
	let min;
	let best = 0;
	const container = $('#' + CONFIG.IDS.VIDEO_CONTAINER);
	
	for (i = 1; i <= peers.size + 1; i++) {
		// j is how many rows you will need if you have i cols
		j = Math.ceil((peers.size + 1) / i);
		// Find the smallest dimension of the video(s) given i and j
		min = Math.min(container.width() / i, container.height() / j);
		if (min > best) {
			best = min;
			cols = i;
		}
	}

	document.documentElement.style.setProperty(CONFIG.CSS.COLS, cols);
}

function configureSocket() {	
	socket.on('signal', (signal) => {		
		const peer = peers.get(signal.sender) || 
			new Peer(signal.sender, localStream);
		
		if (signal.joined) {
			peers.set(peer.id, peer);
		}
		
		if (signal.offer) {
			peer.sendAnswer(signal.offer);
			peers.set(peer.id, peer);
		}
		
		if (signal.answer) {
			peer.handleAnswer(signal.answer);
		}
		
		if (signal.iceCandidate) {
			peer.handleCandidate(signal.iceCandidate);
		}
		
		if (signal.isPresenting) {
			peer.isPresenting = signal.isPresenting;
		}
		
		if (signal.disconnected) {
			peer.isPresenting = false;
			peer.disconnect();
			peers.delete(signal.sender);
		}
	});
}

init();
