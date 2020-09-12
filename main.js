let request = require("request"); // "Request" library
const { response } = require("express");
require("dotenv").config();

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

function getArtsitsPath(fromId, toId) {
    authorize(fromId, toId);
}

// AUTHORIZE
function authorize(from, to) {
    request.post(authOptions, function (error, response, body) {
        setAuthToken(error, response, body, from, to);
    });
}

function setAuthToken(error, response, body, from, to) {
    if (!error && response.statusCode === 200) {
        // use the access token to access the Spotify Web API
        authtoken = body.access_token;
        getArtistGenres(from, to);
        //getRelatedArtists(0, from, to, from);
    } else {
        console.log(body);
    }
}

function getArtistGenres(from, toId) {
    var options = {
        url: `https://api.spotify.com/v1/artists/${toId}`,
        headers: {
            Authorization: "Bearer " + authtoken,
        },
        json: true,
    };
    request.get(options, function (error, response, body) {
        getRelatedArtists(0, from, toId, from, body.genres);
    });
}

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
function getRelatedArtists(depth, artistId, toId, from, toGenres) {
    disableArtist(artistId);
    console.log("Trying : " + artistId + " Depth : " + depth);
    var options = {
        url: `https://api.spotify.com/v1/artists/${artistId}/related-artists`,
        headers: {
            Authorization: "Bearer " + authtoken,
        },
        json: true,
    };
    request.get(options, function (error, response, body) {
        for (let i = 0; i < body.artists.length; i++) {
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
                        getGenreMatchScore(toGenres, body.artists[i].genres),
                });
            }
        }
        //console.log(relatedCache);
        var curLowestArtist = getLowestPathArtist();
        if (curLowestArtist == "NA") {
            //console.log(relatedCache);
            return;
        }
        const inPath = relatedCache.map((artist) => artist.id).includes(toId);
        if (!inPath) {
            //console.log(object);
            let curDep;

            //man idk its like 11:30 PM i just wanna be happy again this works because the asyncines in js sucks and i cant figure it out dammit , its good enogh for now
            //this gets the lowest path depth
            relatedCache.forEach(async (artist) => {
                if (artist.id == curLowestArtist) {
                    curDep = artist.depth;
                }
            });

            getRelatedArtists(
                curDep,
                curLowestArtist,
                toId,
                curLowestArtist,
                toGenres
            );
        } else {
            console.log("FOUND EM BOI , it's : " + toId);
            getArtistBackTrack(fromArtist, toId);
            console.log(finalStackTrace);
            return;
        }
    });
}

//this function gets the artist with the lowest depth score
function getLowestPathArtist() {
    let lowestId;
    //if path is larger than 4 give up (20^4 is alot(blaze it))
    let lowestVal = 4;
    relatedCache.forEach((artist) => {
        if (artist.depth < lowestVal) {
            lowestVal = artist.depth;
            lowestId = artist.id;
        }
    });
    if (!lowestId) {
        console.log("I give up!");
        return "NA";
    }
    return lowestId;
}

//sets the artists depth to 6 so that you wont have to check him twice
function disableArtist(artistId) {
    relatedCache.forEach((artist) => {
        if (artist.id == artistId) {
            artist.depth = 6;
        }
    });
}

//get the full stack of the artist
function getArtistBackTrack(toId, fromId) {
    // if from is not to
    if (fromId != toId) {
        //run through all artists
        relatedCache.forEach((artist) => {
            if (artist.id == fromId) {
                //get its from
                getArtistBackTrack(toId, artist.from);
            }
        });
    } else {
        return;
    }
    finalStackTrace.push(fromId);
}

//relatedCache stores all of the artist's {depth - id - from}
let relatedCache = [];

//finalStackTrace is the finale path to the artist
let finalStackTrace = [];

//artists ids
const fromArtist = "5K4W6rqBFWDnAN6FQUkS6x";
const toArtist = "1EpyA68dKpjf7jXmQL88Hy";
//call get path algrithm
getArtsitsPath(fromArtist, toArtist);
