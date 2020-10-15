import * as admin from 'firebase-admin'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import axios from 'axios'
import * as express from 'express'
import * as Logger from 'logdna'

require('dotenv').config()

const apikey = process.env.API_KEY_LOGDNA
const logger = Logger.createLogger(apikey)

const app = express()
app.use(express.json())

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\n/gm, '\n'),
  }),
  databaseURL: 'https://proginth.firebaseio.com/',
  storageBucket: 'proginth.appspot.com',
})

const readCode = async (id: string, len: number) => {
  try {
    const responseCode: string[] = []
    for (let i = 0; i < len; ++i) {
      const filePath = `submissions/${id}/${i.toString()}`
      const tempPath = path.join(os.tmpdir(), 'temp')
      const existence = await admin.storage().bucket().file(filePath).exists()

      console.log(existence[0])

      if (existence[0] === false) {
        await admin.firestore().doc(`submissions/${id}`).delete()
        return false
      }

      await admin
        .storage()
        .bucket()
        .file(filePath)
        .download({ destination: tempPath })
      const code = fs.readFileSync(tempPath, {
        encoding: 'utf8',
      })
      responseCode.push(code)
    }
    return responseCode
  } catch (error) {
    logger.error(`Error: ${error}`)
    throw error
  }
}

const query = admin
  .firestore()
  .collection('submissions')
  .where('status', '==', 'Pending')
  .orderBy('timestamp', 'desc')
  .limit(1)

try {
  query.onSnapshot((snapshot) => {
    snapshot.forEach(async (doc) => {
      const submissionID = doc.id
      const submission = doc.data()

      logger.log(`Receive Snapshot with ID ${submissionID}`)
      console.log(`Receive Snapshot with ID ${submissionID}: `, submission)

      const taskID = submission.taskID
      const taskDoc = await admin.firestore().doc(`tasks/${taskID}`).get()

      const task = taskDoc.data()

      const codelen = task.type === 'normal' ? 1 : task.fileName.length

      const code = await readCode(submissionID, codelen)

      if (code === false) {
        return
      }

      const targLang = submission.language

      const temp = {
        submissionID,
        taskID,
        targLang,
        code,
      }

      logger.log(`Send Submission ID ${submissionID} To Grader`)
      console.log(`Send Submission ID ${submissionID} To Grader: `, temp)

      await admin.firestore().doc(`submissions/${submissionID}`).update({
        groups: [],
        memory: 0,
        score: 0,
        time: 0,
        status: 'In Queue',
      })
      const userData = (await admin.firestore().doc(`users/${submission.uid}`).get()).data()
      if(userData.passedTask[taskID] !== true) {
        let passedTask = userData.passedTask
        passedTask[taskID] = false;
        await admin.firestore().doc(`users/${submission.uid}`).update({
          passedTask,
        })
      }
      await axios
        .post(`http://localhost:${process.env.OUTPORT}/submit`, temp)
        .catch((e) => {
          logger.error(`Error: ${e}`)
        })
    })
  })
} catch (e) {
  logger.error(`Error: ${e}`)
  console.log('Error: ', e)
}

app.post('/group', async (req, res) => {
  try {
    const result = req.body
    const id = result.SubmissionID

    logger.log(`Received Group id ${id}`)
    console.log(`Received Group id ${id}:`, result)

    const newGroup = result.Results

    const updateGroup = []

    for (const item of newGroup.GroupResults) {
      const status = []
      for (const istatus of item.Status) {
        status.push({
          memory: istatus.Memory,
          message: istatus.Message,
          time: istatus.Time,
          verdict: istatus.Verdict,
        })
      }
      updateGroup.push({
        status,
        score: item.Score,
        fullScore: item.FullScore,
      })
    }

    await admin.firestore().doc(`submissions/${id}`).update({
      groups: updateGroup,
      memory: newGroup.Memory,
      time: newGroup.Time,
      score: newGroup.Score,
    })

    const data = (await admin.firestore().doc(`submissions/${id}`).get()).data()

    const fullScore = data.fullScore
    const uid = data.uid

    if(newGroup.Score === fullScore) {
      const userData = (await admin.firestore().doc(`users/${uid}`).get()).data()
      let passedTask = userData.passedTask
      passedTask[data.taskID] = true
      await admin.firestore().doc(`users/${uid}`).update({
        passedTask,
      })
    }

    res.status(200)
    res.send('Success').end()
  } catch (e) {
    logger.error(`Error: ${e}`)
    console.log('Error: ', e)
    res.status(400)
    res.send('Failed To Update').end()
  }
})

app.post('/message', async (req, res) => {
  try {
    const result = req.body
    const id = result.SubmissionID

    logger.log(`Receive Message ID ${id}: ${result}`)
    console.log(`Receive Message ID ${id}: `, result)

    const status = result.Message
    const docRef = admin.firestore().doc(`submissions/${id}`)

    await docRef.update({
      status,
    })
    res.status(200)
    res.send('Success').end()
  } catch (e) {
    logger.error(`Error: ${e}`)
    // console.log('Error: ', e)
    res.status(400)
    res.send('Failed To Update').end()
  }
})

logger.log(`Start Sync Server At Port: ${process.env.INPORT}`)
app.listen(process.env.INPORT)
