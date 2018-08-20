'use strict';
const adapter = require('webrtc-adapter');

class Message {
  constructor(signal, from, to, content, custom) {
    this.signal = signal;
    this.from = from;
    this.to = to;
    this.content = content;
    this.custom = custom;
  }

  static offerResponse(to, content) {
    return new Message('offerResponse', null, to, content);
  }

  static answerResponse(to, content) {
    return new Message('answerResponse', null, to, content);
  }

  static create(conversationId, custom) {
    return new Message('create', null, null, conversationId, custom);
  }

  static join(conversationId, custom) {
    return new Message('join', null, null, conversationId, custom);
  }

  static left() {
    return new Message('left');
  }

  static candidate(to, candidate) {
    return new Message('candidate', null, to, candidate);
  }

  toJson() {
    return JSON.stringify(this);
  }
}

class SignalingChannel {
  constructor(wsURL) {
    this.onSignal = () => {
    };
    this.waiting = [];
    this.channelReady = false;
    this.websocket = new WebSocket(wsURL);

    this.websocket.onopen = () => {
      this.channelReady = true;
      while (this.waiting.length > 0) {
        this.send(this.waiting.pop());
      }
    };

    this.websocket.onmessage = event => {
      console.log('res: ' + event.data);
      const signal = JSON.parse(event.data);
      this.onSignal(signal.signal, signal);
    };

    this.websocket.onclose = event => {
      this.onSignal('close', event);
    };

    this.websocket.onerror = error => {
      console.log('Communication channel is broken', error);
      this.onSignal('error', error);
    };

  }

  send(payload) {
    if (!this.channelReady) {
      if (payload.signal && payload.signal !== '') {
        this.waiting.push(payload);
      }
    }
    console.log('req: ', payload);
    this.websocket.send(JSON.stringify(payload));
  }

  close() {
    this.websocket.onclose = function () {};
    this.websocket.close();
  }

  setSignal(callback) {
    this.onSignal = callback;
  };
}

class NextRTCClient {

  constructor(configuration) {
    this.configuration = configuration;
    this.handlers = this.initHandlers();
    this.channel = new SignalingChannel(
      configuration.wsURL
    );
    this.localStream = undefined;
    this.peerConnections = {};
    this.channel.setSignal((s, p) => this.execute(s, p));
  }

  on(signal, handler) {
    if (this.handlers[signal]) {
      console.log("Replacing handler for signal: " + signal);
    }
    this.handlers[signal] = handler;
  }

  initHandlers() {
    return {
      'offerRequest': message => this.offerRequest(message),
      'answerRequest': message => this.answerRequest(message),
      'finalize': message => this.finalize(message),
      'candidate': message => this.candidate(message),
      'close': () => this.close(),
      'error': error => {
        console.log("Unexpected situation: ", error);
      },
      'ping': () => {
      },
    };
  }

  getLocalStream(onSuccess) {
    if (this.localStream) {
      onSuccess(this.localStream);
    } else {
      window.navigator.mediaDevices.getUserMedia(this.configuration.mediaConfig)
        .then(stream => {
          onSuccess(stream);
          this.localStream = stream;
          this.execute('localStream', {
            stream: stream
          });
        })
        .catch(err => {
          this.execute('error', 'LocalStream: Unable to get user media ' + err);
        });
    }
  }

  assignTrack(peer, stream) {
    stream.getTracks().forEach(track => peer.addTrack(track, stream));
  }

  getRemoteStream(member) {
    if (this.peerConnections[member] && this.peerConnections[member].stream)
      return this.peerConnections[member].stream;
    return undefined;
  }

  onRemoteStream(member, streams) {
    this.peerConnections[member].streams = streams;
    this.execute('remoteStream', {
      member: member,
      stream: streams[0]
    });
  }

  offerRequest(message) {
    this.getLocalStream(stream =>
      this.offerResponse(message, stream)
    );
  }

  offerResponse(message, stream) {
    this.onPeerConnection(message.from, peer => {
      this.assignTrack(peer, stream);
      peer.createOffer({
          offerToReceiveAudio: this.configuration.mediaConfig.audio ? 1 : 0,
          offerToReceiveVideo: this.configuration.mediaConfig.video ? 1 : 0
        }
      ).then(localDescription => {
        peer.setLocalDescription(localDescription)
          .then(() => this.channel.send(Message.offerResponse(message.from, localDescription.sdp)))
          .catch(err => this.execute('error', 'OfferResponse: Could not set local description' + err));
      }).catch(err => this.execute('error', 'OfferResponse: Could not get local description' + err));
    })
  }

  answerRequest(message) {
    this.getLocalStream(stream =>
      this.answerResponse(message, stream)
    );
  }

  answerResponse(message, stream) {
    this.onPeerConnection(message.from, peer => {
      this.assignTrack(peer, stream);
      peer.setRemoteDescription(new RTCSessionDescription({
        type: 'offer',
        sdp: message.content
      })).then(() => {
        peer.createAnswer().then(
          localDescription => peer.setLocalDescription(localDescription).then(
            () => this.channel.send(Message.answerResponse(message.from, localDescription.sdp))
          ).catch(error => this.execute('error', 'AnswerResponse: Could not set local description of remote stream' + error))
        ).catch(error => this.execute('error', 'AnswerResponse: Could not create answer' + error))
      }).catch(error => this.execute('error', 'AnswerResponse: Could not get remote description' + error));
    });
  };

  finalize(message) {
    this.onPeerConnection(message.from, peer => {
      peer.setRemoteDescription(new RTCSessionDescription({
        type: 'answer',
        sdp: message.content
      })).then(() => {
      }).catch(error => this.execute('error', 'Finalize: Could not set remote description' + error));
    });
  }

  candidate(message) {
    this.onPeerConnection(message.from, peer => {
        peer.addIceCandidate(new RTCIceCandidate(
          JSON.parse(message.content.replace(new RegExp('\'', 'g'), '"')),
          () => console.log('candidates exchanged'),
          (err) => this.execute('error', 'Candidate: Failed to exchange candidates ' + err)
        ))
      }
    );
  }

  onPeerConnection(connectionName, cb) {
    let remoteConnection = this.peerConnections[connectionName];
    if (!remoteConnection) {
      remoteConnection = this.peerConnections[connectionName] = new RTCPeerConnection(this.configuration.peerConfig);
      remoteConnection.ontrack = e => this.onRemoteStream(connectionName, e.streams);
      remoteConnection.onicecandidate = event => this.onIceCandidate(connectionName, event)
      remoteConnection.oniceconnectionstatechange = change => console.log(`(${connectionName}) changed state to`, remoteConnection.iceConnectionState);
    }
    cb(remoteConnection);
  }

  onIceCandidate(member, event) {
    if (event.candidate)
      this.channel.send(Message.candidate(member, JSON.stringify(event.candidate)));
  }

  execute(signal, event) {
    if (this.handlers.hasOwnProperty(signal))
      try {
        this.handlers[signal](event);
      } catch (err) {
        console.log(`User handler on ${signal} failed!`, err);
      }
    else
      console.log('Missing handler for ' + signal);
  }

  create(conversationId, custom) {
    this.channel.send(Message.create(conversationId, custom));
  }

  join(conversationId, custom) {
    this.channel.send(Message.join(conversationId, custom));
  }

  close() {
    this.channel.close();
    for (let member in this.peerConnections) {
      this.release(member);
    }
  }

  release(member) {
    if (this.peerConnections[member])
      this.peerConnections[member].close();
  }

  leave() {
    this.channel.send(Message.left());
    for (let name in this.peerConnections) {
      this.release(name);
    }
  }

}

module.exports = NextRTCClient;
