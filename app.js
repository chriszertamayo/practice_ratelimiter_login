const express = require('express')
const Redis = require('ioredis')
const { RateLimiterRedis } = require('rate-limiter-flexible');


const redisClient = new Redis({ enableOfflineQueue: false })



redisClient.on('connect', () => {
    console.log(`I'm connected`)
})


const maxConsecutiveFailsByUsername = 3

const limiterConsecutiveFailsByUsername = new RateLimiterRedis({
    redis: redisClient,
    keyPrefix: 'login_fail_consecutive_username',
    points: maxConsecutiveFailsByUsername,
    duration: 60 * 30, // Store number for 30 minutes since first fail
    blockDuration: 60 * 30, // Block for 30 minutes
})

const user_username = 'admin'
const user_password = 'admins'

function authorise(username, password) {
    const data = {
        code: 0,
        msg: 'success',
        data: [],
        isLoggedIn: 1
    }

    let user = username === user_username ? true : false

    if (user) {
        if (password === user_password)
            return data
        else {
            data.code = 1
            data.msg = 'failed'
            data.isLoggedIn = 0
            return data
        }

    } else {
        data.code = 1
        data.msg = 'failed'
        data.isLoggedIn = 0
        return data
    }

}

async function loginRoute(req, res) {
    const username = req.body.username;
    const rlResUsername = await limiterConsecutiveFailsByUsername.get(username);

    if (rlResUsername !== null && rlResUsername.consumedPoints > maxConsecutiveFailsByUsername) {
        const retrySecs = Math.round(rlResUsername.msBeforeNext / 1000 || 1)
        res.set('Retry-After', String(retrySecs));
        res.status(429).send('Too Many Requests')
    } else {
        const user = authorise(username, req.body.password); // should be implemented in your project
        console.log(user)
        if (!user.data.isLoggedIn) {
            try {
                await limiterConsecutiveFailsByUsername.consume(username)

                res.status(400).send('email or password is wrong')
            } catch (rlRejected) {
                if (rlRejected instanceof Error) {
                    throw rlRejected
                } else {
                    res.set('Retry-After', String(Math.round(rlRejected.msBeforeNext / 1000 || 1)))
                    res.status(429).send('Too Many Requests')
                }
            }

            if (user.data.isLoggedIn) {
                if (rlResUsername !== null && rlResUsername.consumedPoints > 0) {
                    await limiterConsecutiveFailsByUsername.delete(username)
                }

                res.end('authorised')
            }
        }
    }
}


const app = express()
app.use(express.urlencoded({ extended: true }));
app.use(express.json()) // To parse the incoming requests with JSON payloads

app.post('/login', async (req, res) => {
    try {
        await loginRoute(req, res);
    } catch (err) {
        res.status(500).send();
    }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
    console.log('listening to port 3000')
})