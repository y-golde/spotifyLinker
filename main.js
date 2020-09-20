let request = require("request"); // "Request" library

const { response } = require("express");
const e = require("express");

var sqlite3 = require("sqlite3").verbose();
var db = new sqlite3.Database("database.db");

require("dotenv").config();

//init table
db.serialize(function () {
    db.run(
        "CREATE TABLE if not exists artists ( id TEXT, name TEXT, genres TEXT, img TEXT , pop INTEGER , related TEXT)",
        (err) => {
            console.log(err);
        }
    );
});

const server = require("http").createServer();
const io = require("socket.io")(server);
io.on("connection", (socket) => {
    socket.on("search", (data, direction) => {
        searchArtist(data, socket, direction);
    });
    socket.on("getLink", (data) => {
        getArtsitsPath(data.from, data.to, socket);
    });
    socket.on("disconnect", () => {
        /* … */
    });
});
server.listen(3000);
/*
 *  THE SPOTIFY ARTIST PATHFINDER
 *  this algorithm takes two different artists and finds a link of artists between them usind A* path finding algorithm
 *  with genres matching being h(x)
 *
 */

let client_id = process.env.CLIENT_ID; // Your client id
let client_secret = process.env.CLIENT_SECRET; // Your client secret
let authtoken = "";

// this is the authentication options
let authOptions = {
    url: "https://accounts.spotify.com/api/token",
    headers: {
        Authorization:
            "Basic " +
            new Buffer(client_id + ":" + client_secret).toString("base64"),
    },
    form: {
        grant_type: "client_credentials",
    },
    json: true,
};

function getArtsitsPath(fromId, toId, socket) {
    let relatedCache = [];
    authorize(getArtistGenres(fromId, toId, socket, relatedCache));
}

function searchArtist(text, socket, direction) {
    if (authtoken == "") {
        authorize(search(text, socket, direction));
    } else {
        search("?q=" + text + "&type=artist&limit=5", socket, direction)();
    }
}

function search(q, socket, direction) {
    return function () {
        var options = {
            url: `https://api.spotify.com/v1/search` + q,
            headers: {
                Authorization: "Bearer " + authtoken,
            },
            json: true,
        };
        request.get(options, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                const artists = body.artists.items.map((artist) => {
                    const newArtist = {};
                    if (artist.images[0]) {
                        newArtist.image = artist.images[0].url;
                    }
                    if (artist.name) {
                        newArtist.name = artist.name;
                    }
                    if (artist.id) {
                        newArtist.id = artist.id;
                    }
                    return newArtist;
                });
                socket.emit("searchResult" + direction, artists);
            } else {
            }
        });
    };
}

// AUTHORIZE
function authorize(callback) {
    request.post(authOptions, function (error, response, body) {
        setAuthToken(error, response, body, callback);
    });
}

function setAuthToken(error, response, body, callback) {
    if (!error && response.statusCode === 200) {
        // use the access token to access the Spotify Web API
        authtoken = body.access_token;
        console.log("authorized");
        if (callback) {
            callback();
        }
    } else {
        console.log(error);
    }
}

function getArtistGenres(from, toId, socket, relatedCache) {
    return function () {
        getArtistFromDB(toId, function (row) {
            if (row) {
                const genre = row.genres ? row.genres.split(",") : [];
                getRelatedArtists(
                    0,
                    from,
                    toId,
                    from,
                    genre,
                    socket,
                    relatedCache,
                    from,
                    0
                );
            } else {
                var options = {
                    url: `https://api.spotify.com/v1/artists/${toId}`,
                    headers: {
                        Authorization: "Bearer " + authtoken,
                    },
                    json: true,
                };
                request.get(options, function (error, response, body) {
                    // some artists don't have an image
                    const img = body.images ? body.images[0].url : "";

                    insertArtistIntoDB(
                        body.id,
                        body.name,
                        body.genres.join(),
                        img,
                        body.popularity
                    );
                    getRelatedArtists(
                        0,
                        from,
                        toId,
                        from,
                        body.genres,
                        socket,
                        relatedCache,
                        from,
                        0
                    );
                });
            }
        });
    };
}

function genresCallback(artist) {}

function getGenreMatchScore(targetGenre, compareGenre) {
    let matchScore = 0;
    if (compareGenre) {
        for (const genre of compareGenre) {
            if (targetGenre.includes(genre)) {
                matchScore = matchScore + 1 / targetGenre.length;
            }
        }
    }
    return matchScore;
}
//depth to choose the least deep path
//to find -> key
//from -> prev artist to backtrack
function getRelatedArtists(
    depth,
    artistId,
    toId,
    from,
    toGenres,
    socket,
    relatedCache,
    ogFrom,
    index
) {
    disableArtist(artistId, relatedCache);
    if (index % 25 == 0) {
        getArtistFullDetails(artistId, socket);
    }
    //checks to see if artist in cache already
    getArtistFromDB(artistId, function (row) {
        //if the artist has related already
        const related = row.related;

        if (related) {
            getArtistsFromDB(related, function (row) {
                for (let i = 0; i < row.length; i++) {
                    if (
                        !relatedCache
                            .map((artist) => artist.id)
                            .includes(row[i].id)
                    ) {
                        relatedCache.push({
                            id: row[i].id,
                            from: from,
                            depth:
                                depth +
                                1 -
                                getGenreMatchScore(
                                    toGenres,
                                    row[i].genres.split(",")
                                ),
                        });
                    }
                }
                continueFullArtists(
                    relatedCache,
                    toId,
                    toGenres,
                    socket,
                    ogFrom,
                    index
                );
            });
        } else {
            //console.log("UNFAMILIAR ARTIST ID : " + artistId);
            var options = {
                url: `https://api.spotify.com/v1/artists/${artistId}/related-artists`,
                headers: {
                    Authorization: "Bearer " + authtoken,
                },
                json: true,
            };
            request.get(options, function (error, response, body) {
                if (body.error) {
                    const tryAfter = response.headers["retry-after"];
                    //console.log(`got try after , waiting ${tryAfter} sec`);
                    setTimeout(() => {
                        getRelatedArtists(
                            depth,
                            artistId,
                            toId,
                            from,
                            toGenres,
                            socket,
                            relatedCache,
                            ogFrom,
                            index
                        );
                    }, tryAfter * 1000);
                } else {
                    const idMap = body.artists.map((artist) => artist.id);
                    updateRelated(artistId, idMap.join());
                    for (let i = 0; i < body.artists.length; i++) {
                        const artist = body.artists[i];
                        const img = artist.images ? artist.images[0] : "";
                        insertArtistIntoDB(
                            artist.id,
                            artist.name,
                            artist.genres.join(),
                            img,
                            artist.popularity
                        );
                        if (
                            !relatedCache
                                .map((artist) => artist.id)
                                .includes(body.artists[i].id)
                        ) {
                            relatedCache.push({
                                id: body.artists[i].id,
                                from: from,
                                depth:
                                    depth +
                                    1 -
                                    getGenreMatchScore(
                                        toGenres,
                                        body.artists[i].genres
                                    ),
                            });
                        }
                    }
                    continueFullArtists(
                        relatedCache,
                        toId,
                        toGenres,
                        socket,
                        ogFrom,
                        index
                    );
                }
            });
        }
    });
}

//TODO : find better name
function continueFullArtists(
    relatedCache,
    toId,
    toGenres,
    socket,
    ogFrom,
    index
) {
    //TODO : per-sort the array
    let curLowestArtist = getLowestPathArtist(relatedCache, socket);
    if (curLowestArtist == "NA") {
        return;
    }
    const inPath = relatedCache.map((artist) => artist.id).includes(toId);
    if (!inPath) {
        let curDep;

        //this gets the lowest path depth
        relatedCache.forEach((artist) => {
            if (artist.id == curLowestArtist) {
                curDep = artist.depth;
            }
        });

        getRelatedArtists(
            curDep,
            curLowestArtist,
            toId,
            curLowestArtist,
            toGenres,
            socket,
            relatedCache,
            ogFrom,
            index + 1
        );
    } else {
        //console.log("FOUND EM BOI , it's : " + toId);
        //finalStackTrace is the finale path to the artist
        let finalStackTrace = [ogFrom];
        getArtistBackTrack(ogFrom, toId, relatedCache, finalStackTrace);
        getFullArtists(finalStackTrace, socket);
        return;
    }
}

//this function gets the artist with the lowest depth score
function getLowestPathArtist(relatedCache, socket) {
    let lowestId;
    //if path is larger than 6 give up (20^6 is alot)
    let lowestVal = 6;

    relatedCache.forEach((artist) => {
        if (artist.depth < lowestVal) {
            lowestVal = artist.depth;
            lowestId = artist.id;
        }
    });
    if (!lowestId) {
        socket.emit("giveUp");
        console.log("I give up!");
        return "NA";
    }
    return lowestId;
}

//sets the artists depth to 6 so that you wont have to check him twice
function disableArtist(artistId, relatedCache) {
    relatedCache.forEach((artist) => {
        if (artist.id == artistId) {
            artist.depth = 6;
        }
    });
}

//get the full stack of the artist
function getArtistBackTrack(toId, fromId, relatedCache, finalStackTrace) {
    // if from is not to
    if (fromId != toId) {
        //run through all artists
        relatedCache.forEach((artist) => {
            if (artist.id == fromId) {
                //get its from
                getArtistBackTrack(
                    toId,
                    artist.from,
                    relatedCache,
                    finalStackTrace
                );
            }
        });
    } else {
        return;
    }
    finalStackTrace.push(fromId);
}

//print get the full stack of artists
function getFullArtists(arr, socket) {
    //console.log(arr);
    let arr2 = [];
    let index = 0;

    arr.forEach((artist, i) => {
        getArtistFromDB(artist, (row) => {
            if (!row.name) {
                var options = {
                    url: `https://api.spotify.com/v1/artists/${artist}`,
                    headers: {
                        Authorization: "Bearer " + authtoken,
                    },
                    json: true,
                };
                request.get(options, function (error, response, body) {
                    index++;
                    arr2[i] = {
                        name: body.name,
                        genres: body.genres,
                        id: body.id,
                    };
                    checkDone(arr.length, index, arr2, socket);
                });
            } else {
                index++;
                const genres = row.genres ? row.genres.split(",") : [];
                arr2[i] = {
                    name: row.name,
                    genres: genres,
                    id: row.id,
                };
                checkDone(arr.length, index, arr2, socket);
            }
        });
    });
}

function getArtistFullDetails(artistId, socket) {
    getArtistFromDB(artistId, function (row) {
        const images = row.images ? body.images[0] : {};
        socket.emit("currentlyLoading", row.name, images);
    });
}

function checkDone(len, i, arr, socket) {
    if (len == i) {
        //this is were you'd send the client the full stack of artists to display
        socket.emit("getFullStack", arr);
    }
}
//call get path algrithm
//getArtsitsPath(fromArtist, toArtist);

//DB FUNCTIONS
function getArtistFromDB(artistId, callback) {
    db.get("SELECT * FROM artists WHERE id = ?", [artistId], (err, row) => {
        if (err) {
            console.log(err);
        }
        if (!row) {
            row = {};
        }
        callback(row);
    });
}

function insertArtistIntoDB(id, name, genres, img, pop) {
    db.get("SELECT id FROM artists WHERE id = ?", [id], (err, row) => {
        if (!row) {
            db.run(
                "INSERT INTO artists(id, name, genres, img, pop) VALUES (? ,? , ? ,? ,?)",
                [id, name, genres, img, pop],
                (err, row) => {
                    if (err) {
                        console.log(err);
                    }
                    //console.log("inserted new artist");
                }
            );
        }
    });
}

function updateRelated(artistId, related) {
    db.run(
        "UPDATE artists SET related = ? WHERE id = ?",
        [related, artistId],
        (err) => {
            if (err) {
                console.log(err);
            }
            //console.log("updated related");
        }
    );
}

function getArtistsFromDB(relatedIds, callback) {
    const relatedArr = relatedIds.split(",");
    let query = "SELECT * FROM artists WHERE";
    for (let i = 0; i < relatedArr.length; i++) {
        query += " id = ?";
        if (i != relatedArr.length - 1) {
            query += " OR ";
        }
    }
    db.all(query, relatedArr, (err, row) => {
        if (err) {
            console.log(err);
        }
        callback(row);
    });
}

//added auto authorize when the token is expired
setTimeout(() => {
    authorize();
}, 36000);
