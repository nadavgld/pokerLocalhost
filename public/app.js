var app = angular.module('pokerApp', []);
var socket;

app.controller('mainController', ['$scope', function ($scope) {
    var self = $scope;

    self.login = {}
    self.isLoggedIn = false;

    self.player = {}

    self._cards = []
    self._table = []
    self.position = -1;
    self.watchers = []
    self.others = []
    self.myTurn = false;
    self.gameOver = false;
    self.myBet = {
        "status": "",
        "bet": 0
    }
    self.hideMyCards = false;
    self.role = {
        small: -1,
        big: -1,
        turn: -1
    }
    self.tableBet = 0;
    self.table_tokens = 0;
    self.inGame = false;
    self.isWatcher = true;
    self.waiting = {
        'isWaiting': false,
        'players': 0
    }

    self.init = function () {
        socket = io();

        setTimeout(() => {

            socket.on('moveToLobby', (player) => {
                console.log(player);
                self.isLoggedIn = true;
                self.player = player;

                self.$apply()
            })

            socket.on('loginError', (err) => {
                console.log(err.msg);
            })

            socket.on('noGames', () => {
                waiting.isWaiting = false;
                alert("Could not find any available game")
            })

            socket.on('updateWaiting', function (data) {
                self.waiting.players = data.players;
                $scope.$apply()
            })

            socket.on('draw', function (data) {
                self.inGame = true;
                self._table = []
                self.gameOver = false;
                self.isWatcher = false;
                self.position = data.position;
                self.watchers = data.watchers;
                self.others = data.others;
                self.myTurn = data.role.turn == data.position;
                self.role.small = data.role.small;
                self.role.big = data.role.big;
                self.role.turn = data.role.turn;
                self.myBet.bet = self.role.small == self.position ? data.small : self.role.big == self.position ? data.small * 2 : 0
                self.waiting.isWaiting = false;
                self.table_tokens = data.amount;

                if (data.cards.length > 0) {
                    self._cards = JSON.parse(JSON.stringify(data.cards));
                    self.updateTokens()
                    $scope.$apply()
                }
            })

            socket.on('watchGame', function (data) {
                self.inGame = true;
                self.isWatcher = true;
                self.position = -1;
                self.watchers = data.watchers;
                self.others = data.others;
                self.myTurn = false;
                self.waiting.isWaiting = false;

                $scope.$apply()
            })

            socket.on('updateWatchers', function (amount) {
                self.watchers = amount;
                self.waiting.players = amount;

                $scope.$apply();
            })

            socket.on('updatePlayers', function (players) {
                self.others = players;

                self.others.forEach(p => {
                    if (p.username == self.player.username) {
                        self.player.tokens = p.tokens
                    }
                });

                $scope.$apply();
            })

            socket.on('updateTurn', (game) => {
                self.role.turn = game.turn
                self.table_tokens = game.amount
                self.tableBet = game.highest
                self.myTurn = parseInt(game.turn) == parseInt(self.position)

                $scope.$apply()
            })

            socket.on('nextRound', function (data) {
                var _cards = data.cards;

                if (_cards.length > 0) {
                    if (_cards.length == 3)
                        self._table = JSON.parse(JSON.stringify(_cards))
                    else
                        self._table.push(_cards[0])

                    self.tableBet = 0;
                    self.myBet.bet = 0;
                    $scope.$apply()
                }
            })

            socket.on('gameOver', data => {
                self.gameOver = true;
            
                $scope.$apply();

                setTimeout(() => {
                    alert(data.winner + " just won the game with hand of "+ data.hand +". Congratz, re-draw in few seconds")
                }, 2000);
            })

            socket.on('gameHasStarted', data => {
                alert(data.msg)
                self.waiting.isWaiting = false;
            })

            socket.on('gameCreated', (game) => {
                console.log(game);
                self.tableBet = game.small * 2
                self.waiting.isWaiting = true;
                self.waiting.players = game.waiting.length;

                $scope.$apply()

            })

            socket.on('joinedGame', (game) => {
                console.log(game);
                self.tableBet = game.small * 2
                self.waiting.isWaiting = true;
                self.waiting.players = game.waiting.length;

                $scope.$apply()

            })
        }, 0);

    }

    self.updateTokens = function () {
        for (var i = 0; i < self.others.length; i++) {
            if (self.others[i].username == self.player.username) {
                self.player.tokens = self.others[i].tokens;
                return;
            }
        }
    }

    self.joinGame = function () {
        socket.emit('join')
    }

    self.nextRound = function () {
        socket.emit('nextRound');
    }

    self.cardColor = function (color) {

        if (color == "#000")
            return "card-black";

        return "card-red"
    }

    self.createGame = function () {
        var max = prompt('max players? min 3..', 3)

        while (max < 3)
            max = prompt('max players? min 3..', 3)

        socket.emit('create', { "min": 2, "max": parseInt(max), "small": 2 })
    }

    self.login_register = function () {
        // if (login.username.length == 0 || login.password.length == 0)
            // return;

        socket.emit('login', self.login)
    }

    self.fold = function () {
        self.myBet.status = "fold"
        self.myBet.bet = 0

        socket.emit('makeAMove', self.myBet)
    }

    self.call = function () {
        self.myBet.status = "call";
        self.myBet.bet = self.tableBet - self.myBet.bet

        socket.emit('makeAMove', self.myBet)

        self.myBet.bet = self.tableBet
    }

    self.raise = function () {
        var bet = self.myBet.bet;

        if (bet < self.tableBet * 2) {
            alert("Raise must be at least twice the highest bet")
        } else {

            if (!bet) {
                alert("Cannot bet more than your tokens")
                return;
            }
            self.myBet.status = self.myBet.bet == self.player.tokens ? "all-in" : "raise"
            socket.emit('makeAMove', self.myBet)
        }
    }

    self.splitToHalf = function (others, first) {
        var players = []
        if (first) {
            for (var i = 0; i < Math.ceil(others.length / 2); i++)
                players.push(others[i])
        } else {
            for (var i = Math.ceil(others.length / 2); i < others.length; i++)
                players.unshift(others[i])
        }

        return players;
    }

    self.hasRole = function (other) {
        var pos = other.position;
        var isFolded = other.isFolded;
        var role = ""

        if (isFolded)
            role += " - Folded"

        if (pos == self.role.small)
            role += " - Small"

        else if (pos == self.role.big)
            role += " - Big"

        if (pos == self.role.turn)
            role += " - Playing"

        return role
    }
}])