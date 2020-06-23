import * as admin from 'firebase-admin'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import axios from 'axios'
import * as express from 'express'

require('dotenv').config()

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
    throw error
  }
}

const query = admin
  .firestore()
  .collection('submissions')
  .where('verdict', '==', 'Pending')
  .orderBy('timestamp', 'desc')
  .limit(1)

query.onSnapshot((snapshot) => {
  snapshot.forEach(async (doc) => {
    const submissionID = doc.id
    const submission = doc.data()

    const taskID = submission.taskID
    const taskDoc = await admin.firestore().doc(`tasks/${taskID}`).get()

    const task = taskDoc.data()

    const codelen = task.type === 'normal' ? 1 : task.fileName.length

    const code = await readCode(submissionID, codelen)

    const targLang = submission.language

    const temp = {
      submissionID,
      taskID,
      targLang,
      code,
    }

    await admin.firestore().doc(`submissions/${submissionID}`).update({
      groups: [],
      memory: 0,
      score: 0,
      time: 0,
      verdict: 'In Queue',
    })
    axios.post(`http://localhost:${process.env.OUTPORT}/submit`, temp)
  })
})

app.post('/group', async (req, res) => {
  const result = req.body
  const id = result.SubmissionID

  const docRef = admin.firestore().doc(`submissions/${id}`)
  const data = (await docRef.get()).data()

  const groups = data.groups
  const newGroup = result.Results
  let { memory, time, score } = data
  score += newGroup.Score
  let pushTmp = {
    score: newGroup.Score,
    fullScore: newGroup.FullScore,
    status: [],
  }
  for (const testcase of newGroup.TestResults) {
    pushTmp.status.push({
      memory: testcase.Memory,
      time: testcase.Time,
      message: testcase.Message,
      verdict: testcase.Verdict,
    })
    memory = Math.max(memory, testcase.Memory)
    time = Math.max(time, testcase.Time)
  }
  groups.push(pushTmp)

  try {
    await docRef.update({
      groups,
      memory,
      time,
      score,
    })
    res.status(200)
    res.send('Success')
  } catch (e) {
    res.status(400)
    res.send('Failed To Update')
  }
})

app.post('/message', async (req, res) => {
  const result = req.body
  const id = result.SubmissionID
  const verdict = result.Message
  const docRef = admin.firestore().doc(`submissions/${id}`)
  try {
    await docRef.update({
      verdict,
    })
    res.status(200)
    res.send('Success')
  } catch (e) {
    res.status(400)
    res.send('Failed To Update')
  }
})

app.listen(process.env.INPORT)
