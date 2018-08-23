var express = require('express')
var bodyParser = require('body-parser')
var cors = require('cors')
var Hand = require('pokersolver').Hand;


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
            } else if (p.tokens == 0) {
                socket.emit('loginError', { msg: "can't play, you dont have tokens!" })
                return;
            }
            p.gameid = game.id;
            p.isFolded = false;

            game.waiting.push(p)

            socket.emit('joinedGame', game)

            if (game.round == -1) //not started yet
            {
                if (game.waiting.length == game.min) {
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
        var p = players.find(u => u.id == socket.id);

        if (!p) {
            socket.emit('loginError', { msg: "Error has occoured, please refresh" })
            return;
        } else if (p.tokens == 0) {
            socket.emit('loginError', { msg: "can't play, you dont have tokens!" })
            return;
        }

        createGame(socket, gameInfo)
    })

    socket.on('draw', () => {
        initDraw(socket);
    })

    socket.on('makeAMove', function (move) {
        var p = players.find(u => u.id == socket.id);

        try {
            var game = games.find(g => g.id == p.gameid);
            var position = game.players.findIndex(u => u.id == socket.id);
            p = game.players[position]

            var status = move.status;
            var p_bet = parseInt(move.bet)

            if (status == "fold") {
                p.isFolded = true;

                var amountOfFolded = game.players.filter(pl => !pl.isFolded).length;

                if (amountOfFolded + 1 == game.players.length) {
                    //all folded but one player
                    while (game.role.turn != -1) {
                        nextRound(game)
                    }

                    return;
                }
            } else if (status == "call") {
                var bet = parseInt(game.highest);

                if (p.tokens - bet + p.bet < 0) {
                    socket.emit('cantCall');
                    return;
                }
                p.tokens = p.tokens - bet + p.bet
                game.amount = game.amount + bet - p.bet

                p.bet = bet;

                var tokensLess = game.players.filter(pl => pl.tokens == 0).length

                if (tokensLess + 1 >= game.players.length) {
                    //all has no tokens but one player
                    while (game.role.turn != -1) {
                        nextRound(game)
                    }

                    return;
                }
            } else if (status == "raise") {
                p.bet = p.bet ? p.bet : 0
                p.tokens = p.tokens - p_bet + p.bet;
                game.amount += p_bet - p.bet;
                p.bet = p_bet;
                game.lastToRaise = position;
                game.highest = p_bet;
            } else if (status == "all-in") {
                p.bet += p.tokens;
                game.amount += p.tokens;

                if (game.players[game.lastToRaise].bet != p.bet) {
                    game.highest = p.bet;
                    game.lastToRaise = position;
                    game.isAllIn = true;

                    game.pots.push({
                        amount: p.bet,
                        owner: p.id,
                        players: [
                            p.id
                        ]
                    })
                }

                p.tokens = 0;
            }

            if (game.players.length == 1)
                try {
                    var s = sockets.find(so => so.id == game.players[0].id) || sockets.find(so => so.id == game.waiting[0].id)

                    p.gameid = -1;
                    p.bet = 0;

                    updateServersPlayers(p)

                    game.waiting = []
                    game.players = []

                    updateServersGames(game)

                    s.emit('moveToLobby', { username: p.username, tokens: p.tokens })
                } catch (e) { }

            if (game.round <= 3) {
                var nextTurn = nextPlayerInRound(game)
                game.role.turn = nextTurn;
                updateGamesPlayers(game)
            }

            if (game.players[game.role.turn].bet == game.highest && game.lastToRaise == game.role.turn) {
                var tokensLess = game.players.filter(pl => pl.tokens == 0).length

                if (tokensLess + 1 >= game.players.length) {
                    //all has no tokens but one player
                    while (game.role.turn != -1) {
                        nextRound(game)
                    }

                    return;
                }

                nextRound(game)
            }
        } catch (e) { console.log(e); }
    })

    socket.on('quitGame', () => {
        var p = players.find(u => u.id == socket.id)
        var game = games.find(g => g.id == p.gameid)

        if (p && game) {
            var position = game.players.findIndex(u => u.id == p.id);

            if (position == game.role.turn) {
                clearPlayerFromGame(game, p.id)

                var nextTurn = nextPlayerInRound(game)
                game.role.turn = nextTurn;
            } else
                clearPlayerFromGame(game, p.id)


            p.gameid = -1;

            removeEmptyGames()
            updateGamesPlayers(game)

            socket.emit('moveToLobby', { username: p.username, tokens: p.tokens })
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
            var position = games[idx].players.findIndex(u => u.id == p.id);

            if (position == games[idx].role.turn) {
                var nextTurn = nextPlayerInRound(games[idx])
                games[idx].role.turn = nextTurn;
                updateGamesPlayers(games[idx])
            }
            clearPlayerFromGame(games[idx], p.id)
        }

        p.id = -1;

        updateServersPlayers(p)
    }
}


http.listen(port, '0.0.0.0', () => console.log('app is on ' + port))

function updateGamesPlayers(game) {

    game.players.forEach(player => {
        var s = sockets.find(sk => sk.id == player.id)

        if (s) {
            var { others, watchers } = getPlayersInGame(game, s.id);
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
        var hands = getPlayersHands(game);
        var winnerHand = Hand.winners(hands);

        game.role.turn = -1;

        var winner = getPlayerByCards(game, winnerHand)
        winner.tokens += game.amount;

        console.log("Winner is " + winner.username + " with hand of " + winnerHand[0].name)
        game.players.forEach(player => {
            var s = sockets.find(sk => sk.id == player.id)
            if (s) {
                s.emit('gameOver', { "winner": winner.username, "hand": winnerHand[0].name })
            }
        })

        game.waiting.forEach(player => {
            var s = sockets.find(sk => sk.id == player.id)
            if (s) {
                s.emit('gameOver', { "winner": winner.username, "hand": winnerHand[0].name })
            }
        })

        updateGamesPlayers(game)

        setTimeout(() => {
            console.log("new game in 10 seconds")
            restartGame(game)
        }, 10 * 1000);
    }
}

function getPlayerByCards(game, cards) {
    var winner;
    game.players.forEach(p => {

        var playerCards = JSON.parse(JSON.stringify(game.tableCards))
        playerCards = playerCards.concat(p.cards)

        var p_c = [];
        playerCards.forEach(c => {

            var number = c.number == "10" ? "T" : c.number;
            var shape = c.symbol.shape.charAt(0).toLowerCase();

            p_c.push(number.concat(shape))

        })
        var hand = Hand.solve(p_c)

        if (hand.toString() == cards.toString())
            winner = p;
    })

    return winner;
}

function getPlayersHands(game) {
    var all_players = []

    game.players.forEach(p => {
        if (!p.isFolded) {
            var playerCards = JSON.parse(JSON.stringify(game.tableCards))
            playerCards = playerCards.concat(p.cards)

            var p_c = [];
            playerCards.forEach(c => {

                var number = c.number == "10" ? "T" : c.number;
                var shape = c.symbol.shape.charAt(0).toLowerCase();

                p_c.push(number.concat(shape))

            })
            var hand = Hand.solve(p_c)
            all_players.push(hand)
        }
    })

    return all_players;
}

function nextPlayerInRound(game) {
    if (game.round == 4)
        return -1;

    var currentPlayer = parseInt(game.role.turn);
    var currentPlayer = (currentPlayer + 1) % game.players.length;

    while (game.players[currentPlayer].isFolded && game.players[currentPlayer].tokens == 0)
        currentPlayer = (currentPlayer + 1) % game.players.length;

    return currentPlayer;
}

function restartGame(game) {

    game.waiting = game.waiting.concat(JSON.parse(JSON.stringify(game.players)))
    game.players = [];
    game.round = -1;
    game.deck = Deck()

    var socketsToRemove = []

    game.waiting.forEach(w => {
        w.cards = []
        w.bet = 0
        w.isFolded = false

        var s = sockets.find(so => so.id == w.id)

        if (w.tokens == 0) {

            updateServersPlayers(w)
            s.emit('loginError', { msg: "can't play, you dont have tokens!" })
            socketsToRemove.push(s)
        }
        else
            s.emit('joinedGame', game)
    })

    socketsToRemove.forEach(s => kickFromGame(s))

    if (game.waiting.length > 1)
        setTimeout(() => {
            startGame(game, true)
        }, 500);
    else {
        try {
            var s = sockets.find(so => so.id == game.waiting[0].id)
            var p = game.waiting[0]

            p.gameid = -1

            updateServersPlayers(p)

            game.waiting = []
            game.players = []

            updateServersGames(game)

            s.emit('moveToLobby', { username: p.username, tokens: p.tokens })
        } catch (e) { console.log(e); }
    }

    removeEmptyGames()
}

function updateServersPlayers(p) {
    var player = players.find(pl => pl.id == p.id)
    player = p
}

function updateServersGames(g) {
    var game = players.find(gl => gl.id == g.id)
    game = g
}

function removeEmptyGames() {
    var gamesToRemove = []
    games.forEach(g => {
        if (g.players.length + g.waiting.length == 0) {
            gamesToRemove.push(g.id)
        }
    })

    console.log("g " + gamesToRemove.length + " games");
    gamesToRemove.forEach(gid => games.splice(gid, 1))
}

function kickFromGame(socket) {
    var p = players.find(u => u.id == socket.id);
    var game = games.find(g => g.id == p.gameid);

    if (game && p) {
        var p_idx = game.waiting.findIndex(pl => pl.id == p.id);
        if (p_idx)
            game.waiting.splice(p_idx, 1)

        p.gameid = -1

        updateServersPlayers(p)
        updateServersGames(game)

        socket.emit('moveToLobby', { username: p.username, tokens: p.tokens })
    }
}

function startGame(game, restarted) {
    console.log("new game!")
    var waitingList = JSON.parse(JSON.stringify(game.waiting))
    game.players = waitingList;
    setPlayersToNewGame(game.players)

    game.waiting = [];
    game.pots = [];
    game.isAllIn = false;

    if (!restarted) {
        game.role = {};

        var small = Math.floor(Math.random() * game.players.length);
        game.role.small = small
        game.role.big = (small + 1) % game.players.length
        game.role.turn = (game.role.big + 1) % game.players.length
    } else {

        game.role.small = game.role.big
        game.role.big = (game.role.small + 1) % game.players.length
        game.role.turn = (game.role.big + 1) % game.players.length
    }

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
    updateGamesPlayers(game)
}

function setPlayersToNewGame(players) {
    players.forEach(p => p.isFolded = false)
}

function initDraw(socket) {
    var p = players.find(u => u.id == socket.id);
    var game = games.find(g => g.id == p.gameid);
    try {

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
    } catch (e) { }
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
    try {
        var pl = game.players.findIndex(p => p.id == player_id);

        if (pl > -1)
            game.players.splice(pl, 1)

        pl = game.waiting.findIndex(p => p.id == player_id);
        if (pl > -1)
            game.waiting.splice(pl, 1)

        if (game.players.length == 0 && game.waiting.length == 0) {
            var g_idx = games.findIndex(g => g.id == game.id);
            games.splice(g_idx, 1)
        } else
            updateGamesPlayers(game)
    } catch (e) { }

    updateServersGames(game)
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
        "deck": Deck(),
        "isAllIn": false
    };

    var p = players.find(u => u.id == socket.id);
    if (p) {
        p.gameid = _id;
        p.isFolded = false;

        newGame.waiting.push(p)
    }

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

    removeEmptyGames()

    for (var i = 0; i < games.length; i++) {
        if (games[i].players.length + games[i].waiting.length < games[i].max && games[i].round == -1)
            return games[i];
    }

    for (var i = 0; i < games.length; i++) {
        if (games[i].players.length + games[i].waiting.length < games[i].max)
            return games[i];
    }

    return null;
}