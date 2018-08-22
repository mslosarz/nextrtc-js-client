'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var adapter = require('webrtc-adapter');

var Message = function () {
  function Message(signal, from, to, content, custom) {
    _classCallCheck(this, Message);

    this.signal = signal;
    this.from = from;
    this.to = to;
    this.content = content;
    this.custom = custom;
  }

  _createClass(Message, [{
    key: 'toJson',
    value: function toJson() {
      return JSON.stringify(this);
    }
  }], [{
    key: 'offerResponse',
    value: function offerResponse(to, content) {
      return new Message('offerResponse', null, to, content);
    }
  }, {
    key: 'answerResponse',
    value: function answerResponse(to, content) {
      return new Message('answerResponse', null, to, content);
    }
  }, {
    key: 'create',
    value: function create(conversationId, custom) {
      return new Message('create', null, null, conversationId, custom);
    }
  }, {
    key: 'join',
    value: function join(conversationId, custom) {
      return new Message('join', null, null, conversationId, custom);
    }
  }, {
    key: 'left',
    value: function left() {
      return new Message('left');
    }
  }, {
    key: 'candidate',
    value: function candidate(to, _candidate) {
      return new Message('candidate', null, to, _candidate);
    }
  }]);

  return Message;
}();

var SignalingChannel = function () {
  function SignalingChannel(wsURL, debug) {
    var _this = this;

    _classCallCheck(this, SignalingChannel);

    this.debug = debug;
    this.onSignal = function () {};
    this.waiting = [];
    this.channelReady = false;
    this.websocket = new WebSocket(wsURL);

    this.websocket.onopen = function () {
      _this.channelReady = true;
      while (_this.waiting.length > 0) {
        _this.send(_this.waiting.pop());
      }
    };

    this.websocket.onmessage = function (event) {
      if (debug) {
        console.log('res: ' + event.data);
      }
      var signal = JSON.parse(event.data);
      _this.onSignal(signal.signal, signal);
    };

    this.websocket.onclose = function (event) {
      _this.onSignal('close', event);
    };

    this.websocket.onerror = function (error) {
      if (debug) {
        console.log('Communication channel is broken', error);
      }
      _this.onSignal('error', error);
    };
  }

  _createClass(SignalingChannel, [{
    key: 'send',
    value: function send(payload) {
      if (!this.channelReady) {
        if (payload.signal && payload.signal !== '') {
          this.waiting.push(payload);
        }
      }
      if (this.debug) {
        console.log('req: ', payload);
      }
      this.websocket.send(JSON.stringify(payload));
    }
  }, {
    key: 'close',
    value: function close() {
      this.websocket.onclose = function () {};
      this.websocket.close();
    }
  }, {
    key: 'setSignal',
    value: function setSignal(callback) {
      this.onSignal = callback;
    }
  }]);

  return SignalingChannel;
}();

var NextRTCClient = function () {
  function NextRTCClient(configuration) {
    var _this2 = this;

    var debug = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

    _classCallCheck(this, NextRTCClient);

    this.debug = debug;
    this.configuration = configuration;
    this.handlers = this.initHandlers();
    this.channel = new SignalingChannel(configuration.wsURL, this.debug);
    this.localStream = undefined;
    this.peerConnections = {};
    this.channel.setSignal(function (s, p) {
      return _this2.execute(s, p);
    });
  }

  _createClass(NextRTCClient, [{
    key: 'on',
    value: function on(signal, handler) {
      if (this.handlers[signal]) {
        if (this.debug) {
          console.log("Replacing handler for signal: " + signal);
        }
      }
      this.handlers[signal] = handler;
    }
  }, {
    key: 'initHandlers',
    value: function initHandlers() {
      var _this3 = this;

      return {
        'offerRequest': function offerRequest(message) {
          return _this3.offerRequest(message);
        },
        'answerRequest': function answerRequest(message) {
          return _this3.answerRequest(message);
        },
        'finalize': function finalize(message) {
          return _this3.finalize(message);
        },
        'candidate': function candidate(message) {
          return _this3.candidate(message);
        },
        'close': function close() {
          return _this3.close();
        },
        'error': function error(_error) {
          console.log("Unexpected situation: ", _error);
        },
        'ping': function ping() {}
      };
    }
  }, {
    key: 'getLocalStream',
    value: function getLocalStream(onSuccess) {
      var _this4 = this;

      if (this.localStream) {
        onSuccess(this.localStream);
      } else {
        window.navigator.mediaDevices.getUserMedia(this.configuration.mediaConfig).then(function (stream) {
          onSuccess(stream);
          _this4.localStream = stream;
          _this4.execute('localStream', {
            stream: stream
          });
        }).catch(function (err) {
          _this4.execute('error', 'LocalStream: Unable to get user media ' + err);
        });
      }
    }
  }, {
    key: 'assignTrack',
    value: function assignTrack(peer, stream) {
      stream.getTracks().forEach(function (track) {
        return peer.addTrack(track, stream);
      });
    }
  }, {
    key: 'getRemoteStream',
    value: function getRemoteStream(member) {
      if (this.peerConnections[member] && this.peerConnections[member].stream) return this.peerConnections[member].stream;
      return undefined;
    }
  }, {
    key: 'onRemoteStream',
    value: function onRemoteStream(member, streams) {
      this.peerConnections[member].streams = streams;
      this.execute('remoteStream', {
        member: member,
        stream: streams[0]
      });
    }
  }, {
    key: 'offerRequest',
    value: function offerRequest(message) {
      var _this5 = this;

      this.getLocalStream(function (stream) {
        return _this5.offerResponse(message, stream);
      });
    }
  }, {
    key: 'offerResponse',
    value: function offerResponse(message, stream) {
      var _this6 = this;

      this.onPeerConnection(message.from, function (peer) {
        _this6.assignTrack(peer, stream);
        peer.createOffer({
          offerToReceiveAudio: _this6.configuration.mediaConfig.audio ? 1 : 0,
          offerToReceiveVideo: _this6.configuration.mediaConfig.video ? 1 : 0
        }).then(function (localDescription) {
          peer.setLocalDescription(localDescription).then(function () {
            return _this6.channel.send(Message.offerResponse(message.from, localDescription.sdp));
          }).catch(function (err) {
            return _this6.execute('error', 'OfferResponse: Could not set local description' + err);
          });
        }).catch(function (err) {
          return _this6.execute('error', 'OfferResponse: Could not get local description' + err);
        });
      });
    }
  }, {
    key: 'answerRequest',
    value: function answerRequest(message) {
      var _this7 = this;

      this.getLocalStream(function (stream) {
        return _this7.answerResponse(message, stream);
      });
    }
  }, {
    key: 'answerResponse',
    value: function answerResponse(message, stream) {
      var _this8 = this;

      this.onPeerConnection(message.from, function (peer) {
        _this8.assignTrack(peer, stream);
        peer.setRemoteDescription(new RTCSessionDescription({
          type: 'offer',
          sdp: message.content
        })).then(function () {
          peer.createAnswer().then(function (localDescription) {
            return peer.setLocalDescription(localDescription).then(function () {
              return _this8.channel.send(Message.answerResponse(message.from, localDescription.sdp));
            }).catch(function (error) {
              return _this8.execute('error', 'AnswerResponse: Could not set local description of remote stream' + error);
            });
          }).catch(function (error) {
            return _this8.execute('error', 'AnswerResponse: Could not create answer' + error);
          });
        }).catch(function (error) {
          return _this8.execute('error', 'AnswerResponse: Could not get remote description' + error);
        });
      });
    }
  }, {
    key: 'finalize',
    value: function finalize(message) {
      var _this9 = this;

      this.onPeerConnection(message.from, function (peer) {
        peer.setRemoteDescription(new RTCSessionDescription({
          type: 'answer',
          sdp: message.content
        })).then(function () {}).catch(function (error) {
          return _this9.execute('error', 'Finalize: Could not set remote description' + error);
        });
      });
    }
  }, {
    key: 'candidate',
    value: function candidate(message) {
      var _this10 = this;

      this.onPeerConnection(message.from, function (peer) {
        peer.addIceCandidate(new RTCIceCandidate(JSON.parse(message.content.replace(new RegExp('\'', 'g'), '"')), function () {
          return _this10.debug ? console.log('candidates exchanged') : null;
        }, function (err) {
          return _this10.execute('error', 'Candidate: Failed to exchange candidates ' + err);
        }));
      });
    }
  }, {
    key: 'onPeerConnection',
    value: function onPeerConnection(connectionName, cb) {
      var _this11 = this;

      var remoteConnection = this.peerConnections[connectionName];
      if (!remoteConnection) {
        remoteConnection = this.peerConnections[connectionName] = new RTCPeerConnection(this.configuration.peerConfig);
        remoteConnection.ontrack = function (e) {
          return _this11.onRemoteStream(connectionName, e.streams);
        };
        remoteConnection.onicecandidate = function (event) {
          return _this11.onIceCandidate(connectionName, event);
        };
        remoteConnection.oniceconnectionstatechange = function (change) {
          return _this11.debug ? console.log('(' + connectionName + ') changed state to', remoteConnection.iceConnectionState) : null;
        };
      }
      cb(remoteConnection);
    }
  }, {
    key: 'onIceCandidate',
    value: function onIceCandidate(member, event) {
      if (event.candidate) this.channel.send(Message.candidate(member, JSON.stringify(event.candidate)));
    }
  }, {
    key: 'execute',
    value: function execute(signal, event) {
      if (this.handlers.hasOwnProperty(signal)) try {
        this.handlers[signal](event);
      } catch (err) {
        if (this.debug) {
          console.log('User handler on ' + signal + ' failed!', err);
        }
      } else if (this.debug) {
        console.log('Missing handler for ' + signal);
      }
    }
  }, {
    key: 'create',
    value: function create(conversationId, custom) {
      this.channel.send(Message.create(conversationId, custom));
    }
  }, {
    key: 'join',
    value: function join(conversationId, custom) {
      this.channel.send(Message.join(conversationId, custom));
    }
  }, {
    key: 'close',
    value: function close() {
      this.channel.close();
      for (var member in this.peerConnections) {
        this.release(member);
      }
    }
  }, {
    key: 'release',
    value: function release(member) {
      if (this.peerConnections[member]) this.peerConnections[member].close();
    }
  }, {
    key: 'leave',
    value: function leave() {
      this.channel.send(Message.left());
      for (var name in this.peerConnections) {
        this.release(name);
      }
    }
  }]);

  return NextRTCClient;
}();

module.exports = NextRTCClient;