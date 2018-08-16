var express = require('express')
var bodyParser = require('body-parser')
var cors = require('cors')

var app = express()
var http = require('http').Server(app);
var io = require('socket.io')(http);

app.use(cors())

const port = process.env.PORT || 5050
const GameManager = require('./modules/gameManager')

GameManager.newGame()

app.use(express.static('public'))

app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

var sockets = [];
var players = [];
var games = [];

io.on('connection', function (socket) {
    sockets.push(socket);
    console.log(socket.id + ' user connected');

    socket.on('disconnect', function () {
        removeSocket(socket.id);
        GameManager.removePlayer(socket.id)
    });

    socket.on('login', (player) => {
        var p = playerExists(player.username)
        if (p && passwordMatched(p, player)) {
            if (p.id == -1) {
                p.id == socket.id

                socket.emit('moveToLobby', { username: p.username, tokens: p.tokens })
            } else {
                socket.emit('loginError', { msg: "User is already logged in" })
            }
        } else if (p) {
            socket.emit('loginError', { msg: "Unmatched username and password" })
        } else {
            var p = {
                username: player.username,
                password: player.password,
                id: socket.id,
                tokens: 10000
            }

            players.push(p)

            socket.emit('moveToLobby', { username: p.username, tokens: p.tokens })
        }
    })

    socket.on('join', () => {
        var game = findFreeGame()

        if (!game) {
            socket.emit("noGames")
        } else {
            var p = players.find(u => u.id == socket.id);

            if (!p) {
                socket.emit('loginError', { msg: "Error has occoured, please refresh" })
                return;
            }
            p.gameid = game.id;
            p.isFolded = false;

            game.waiting.push(p)

            socket.emit('joinedGame', game)

            if (game.round == -1) //not started yet
            {
                if (game.waiting.length == game.max) {
                    //start A game
                    startGame(game);
                } else {
                    updateGamesPlayers(game)
                }
            } else {
                var { others, watchers } = getPlayersInGame(game, socket.id);
                socket.emit('watchGame', { "others": others, "watchers": game.waiting.length })
                updateGamesPlayers(game)
            }
        }
    })

    socket.on('create', (gameInfo) => {
        createGame(socket, gameInfo)
    })

    socket.on('draw', () => {
        // var cards = GameManager.drawCard(2, socket.id)
        initDraw(socket);
    })

    socket.on('makeAMove', function (move) {
        var p = players.find(u => u.id == socket.id);
        var game = games.find(g => g.id == p.gameid);
        var position = game.players.findIndex(u => u.id == socket.id);
        p = game.players[position]

        var status = move.status;
        var p_bet = parseInt(move.bet)

        if (status == "fold") {
            p.isFolded = true;
        } else if (status == "call") {
            var bet = parseInt(game.highest);
            p.bet = bet;
            p.tokens -= p_bet
            game.amount += p_bet
        }

        var nextTurn = nextPlayerInRound(game)
        game.role.turn = nextTurn;
        updateGamesPlayers(game)

        if (game.players[game.role.turn].bet == game.highest && game.lastToRaise == game.role.turn) {
            nextRound(game)
        }
    })
});

app.get('/', (req, res) => {
    res.send("Welcome")
})

function passwordMatched(p1, p2) {
    return p1.password == p2.password && p1.username == p2.username
}

function playerExists(username) {
    var p = players.find(u => u.username == username);
    return p;
}

function removeSocket(id) {
    for (var i = 0; i < sockets.length; i++)
        if (sockets[i].id == id) {
            sockets.splice(i, 1)
            break;
        }

    var p = players.find(u => u.id == id)

    if (p) {
        if (p.gameid != -1) {
            var idx = games.findIndex(g => g.id == p.gameid);
            clearPlayerFromGame(games[idx], p.id)
        }

        p.id = -1;
    }
}


http.listen(port, '0.0.0.0', () => console.log('app is on ' + port))

function updateGamesPlayers(game) {

    game.players.forEach(player => {
        var s = sockets.find(sk => sk.id == player.id)
        var { others, watchers } = getPlayersInGame(game, s.id);

        if (s) {
            s.emit('updateWatchers', game.waiting.length)
            s.emit('updatePlayers', others)

            if (game.role)
                s.emit('updateTurn', {
                    turn: game.role.turn,
                    amount: game.amount,
                    highest: game.highest
                })
        }
    })

    game.waiting.forEach(player => {
        var s = sockets.find(sk => sk.id == player.id)
        var { others, watchers } = getPlayersInGame(game, s.id);

        if (s) {
            s.emit('updateWatchers', game.waiting.length)
            s.emit('updatePlayers', others)

            if (game.role)
                s.emit('updateTurn', {
                    turn: game.role.turn,
                    amount: game.amount,
                    highest: game.highest
                })
        }
    })
}

function nextRound(game) {
    game.round++;

    if (game.round == 1) {
        var { deck, cards } = drawCards(game.deck, 3);

        game.tableCards = cards;
        game.deck = deck;

        game.players.forEach(player => {
            var s = sockets.find(sk => sk.id == player.id)
            if (s) {
                s.emit('nextRound', { cards: cards })
            }
        })

        game.waiting.forEach(player => {
            var s = sockets.find(sk => sk.id == player.id)
            if (s) {
                s.emit('nextRound', { cards: cards })
            }
        })

        game.highest = 0;
        game.players.forEach(p => p.bet = 0);
        updateGamesPlayers(game)

    } else if (game.round == 2 || game.round == 3) {
        var { deck, cards } = drawCards(game.deck, 1);

        game.tableCards.push(cards[0]);
        game.deck = deck;

        game.players.forEach(player => {
            var s = sockets.find(sk => sk.id == player.id)
            if (s) {
                s.emit('nextRound', { cards: cards })
            }
        })

        game.waiting.forEach(player => {
            var s = sockets.find(sk => sk.id == player.id)
            if (s) {
                s.emit('nextRound', { cards: cards })
            }
        })

        game.highest = 0;
        game.players.forEach(p => p.bet = 0);
        updateGamesPlayers(game)
    } else {
        console.log("calculate winner");

        game.players.forEach(player => {
            var s = sockets.find(sk => sk.id == player.id)
            if (s) {
                s.emit('gameOver', {})
            }
        })

        game.waiting.forEach(player => {
            var s = sockets.find(sk => sk.id == player.id)
            if (s) {
                s.emit('gameOver', {})
            }
        })

        updateGamesPlayers(game)
    }
}

function nextPlayerInRound(game) {
    var currentPlayer = parseInt(game.role.turn);
    var currentPlayer = (currentPlayer + 1) % game.players.length;

    while (game.players[currentPlayer].isFolded)
        currentPlayer = (currentPlayer + 1) % game.players.length;

    return currentPlayer;
}

function startGame(game) {
    var waitingList = JSON.parse(JSON.stringify(game.waiting))
    game.players = waitingList;
    setPlayersToNewGame(game.players)

    game.role = {};
    game.waiting = [];

    var small = Math.floor(Math.random() * game.players.length);
    game.role.small = small
    game.role.big = (small + 1) % game.players.length
    game.role.turn = (game.role.big + 1) % game.players.length

    game.amount = game.small * 3;
    game.highest = game.small * 2;
    game.lastToRaise = game.role.big;

    game.players.forEach(player => {
        var s = sockets.find(sk => sk.id == player.id)
        initDraw(s);
    })

    game.players.forEach(p => {
        var s = sockets.find(sk => sk.id == p.id)

        var { others, watchers } = getPlayersInGame(game, s.id);
        s.emit('updatePlayers', others)
    })

    game.round = 0;
}

function setPlayersToNewGame(players) {
    players.forEach(p => p.isFolded = false)
}

function initDraw(socket) {
    var p = players.find(u => u.id == socket.id);
    var game = games.find(g => g.id == p.gameid);
    var position = game.players.findIndex(u => u.id == socket.id);
    p = game.players[position]
    p.isFolded = false;

    var { deck, cards } = drawCards(game.deck, 2);
    p.cards = cards;
    game.deck = deck;

    if (position == game.role.small) {
        p.bet = game.small
        p.tokens -= game.small

    } else if (position == game.role.big) {
        p.bet = (game.small * 2)
        p.tokens -= (game.small * 2)
    }

    var { others, watchers } = getPlayersInGame(game, socket.id);
    socket.emit('draw', {
        "cards": cards,
        "position": position,
        "totalCards": game.deck.length,
        "others": others,
        "watchers": watchers.length,
        "small": game.small,
        "highest": game.small * 2,
        "role": {
            "small": game.role.small,
            "big": game.role.big,
            "turn": game.role.turn
        },
        "amount": game.amount
    })
}

function getPlayersInGame(game, me) {
    var others = [];
    game.players.forEach((p, idx) => {
        others.push({
            username: p.username,
            tokens: p.tokens,
            bet: p.bet ? p.bet : 0,
            position: idx,
            isFolded: p.isFolded,
            cards: game.round == 4 ? p.cards : []
        })
    })

    var watchers = [];
    game.waiting.forEach(p => {
        if (p.id == me)
            return;

        watchers.push({
            username: p.username,
            tokens: p.tokens
        })
    })

    return { others, watchers }
}

function clearPlayerFromGame(game, player_id) {
    // var isTurn = false;
    try {
        var pl = game.players.findIndex(p => p.id == player_id);

        // isTurn = pl == game.turn

        if (pl > -1)
            game.players.splice(pl, 1)

        pl = game.waiting.findIndex(p => p.id == player_id);
        if (pl > -1)
            game.waiting.splice(pl, 1)
    } catch (e) { }

    if (game.players.length == 0) {
        var g_idx = games.findIndex(g => g.id == game.id);
        games.splice(g_idx, 1)
    } else
        updateGamesPlayers(game)
}

function createGame(socket, gameInfo) {
    var _id = GameManager.generateId();

    var newGame = {
        "id": _id,
        "min": gameInfo.min || 2,
        "max": gameInfo.max || 8,
        "small": gameInfo.small || 2,
        "players": [],
        "waiting": [],
        "round": -1,
        "deck": Deck()
    };

    var p = players.find(u => u.id == socket.id);
    p.gameid = _id;
    newGame.waiting.push(p)

    games.push(newGame)

    socket.emit('gameCreated', newGame)
}

function Deck() {
    const _symbols = [
        {
            "shape": "Heart",
            "icon": "♥",
            "color": "#ff0000"
        },
        {
            "shape": "Diamond",
            "icon": "♦",
            "color": "#ff0000"
        },
        {
            "shape": "Spade",
            "icon": "♠",
            "color": "#000"
        },
        {
            "shape": "Club",
            "icon": "♣",
            "color": "#000"
        }
    ]

    const _numbers = [
        "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"
    ]

    var cards = []
    _numbers.forEach(n => {
        _symbols.forEach(s => {
            cards.push({
                "number": n,
                "symbol": s
            })
        })
    })

    return cards;
}

function drawCards(deck, number) {
    var cards = [];

    for (var i = 0; i < number; i++) {
        var rnd = Math.floor(Math.random() * deck.length)

        cards.push(deck[rnd])
        deck.splice(rnd, 1);
    }

    return { deck: deck, cards: cards };
}

function findFreeGame() {
    for (var i = 0; i < games.length; i++) {
        if (games[i].players.length + games[i].waiting.length < games[i].max)
            return games[i];
    }

    return null;
}