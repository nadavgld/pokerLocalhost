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
                self.moveToLobby(player)
            })

            socket.on('loginError', (err) => {
                self.inGame = false;
                self.isWatcher = false;
                self.waiting.isWaiting = false;
                self.$apply()
                
                alert(err.msg);
            })

            socket.on('noGames', () => {
                self.isLoggedIn = true;
                self.inGame = false;
                self.isWatcher = false;
                self.waiting.isWaiting = false;
                self.$apply()

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
                        self.animateTokens(p.tokens, self.player.tokens)

                        setTimeout(() => {
                            self.player.tokens = p.tokens
                        }, 4000);
                    }
                });

                $scope.$apply();

                if (self.others.length == 1)
                    self.moveToLobby(self.player)
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
                self.role.turn = -1;
                self.myTurn = false;

                $scope.$apply();

                setTimeout(() => {
                    var name = data.winner == self.player.username ? "You've" : data.winner;
                    alert(name + " just won the game with hand of " + data.hand + ". Congratz, re-draw in few seconds")
                }, 2000);
            })

            socket.on('cantCall', () =>{
                alert("You cannot Call because of low amount of tokens")
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
                self.animateTokens(self.others[i].tokens, self.player.tokens)
                self.player.tokens = self.others[i].tokens;
                return;
            }
        }
    }

    self.moveToLobby = function (player) {
        console.log(player);
        self.isLoggedIn = true;
        self.inGame = false;
        self.isWatcher = false;
        self.waiting.isWaiting = false;
        self.player = player;

        self.$apply()
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
        var max = prompt('max players? min 2..', 2)

        while (max < 2)
            max = prompt('max players? min 2..', 2)

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
        // self.myBet.bet = self.tableBet - self.myBet.bet
        self.myBet.bet = self.tableBet

        socket.emit('makeAMove', { status: "call", bet: self.tableBet })

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
            // self.myBet.status = "raise"
            self.myBet.status = self.myBet.bet == self.player.tokens ? "all-in" : "raise"
            socket.emit('makeAMove', self.myBet)
        }
    }

    self.allIn = function () {
        self.myBet.status = "all-in";
        self.myBet.bet = self.player.tokens
        socket.emit('makeAMove', self.myBet)
    }

    self.quitGame = function(){
        socket.emit('quitGame')
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

    self.isPlaying = function (other) {
        if (other.position == self.role.turn)
            return "playing"

        return "notPlaying"
    }

    var intr;
    var mls = 1;
    self.animateTokens = function (amount, tokens) {
        clearInterval(intr);
        mls = Math.ceil(Math.abs(tokens - amount) / 300)

        intr = setInterval(() => {
            if (tokens <= amount) {
                if (tokens + mls <= amount)
                    tokens += mls
                else {
                    tokens = amount;
                    clearInterval(intr)
                }
            } else {
                if (tokens - mls >= amount)
                    tokens -= mls
                else {
                    tokens = amount;
                    clearInterval(intr)
                }
            }
            $("#playerTokens").text(tokens)
        }, 1)
    }

    self.canCall = function () {
        if (self.tableBet == 0)
            return "Check"

        return "Call"
    }

}])