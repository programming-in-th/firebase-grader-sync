import * as admin from 'firebase-admin'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import axios from 'axios'

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\n/gm, '\n'),
  }),
  databaseURL: 'https://proginth.firebaseio.com/',
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
  .where('status', '==', 'pending')
  .orderBy('timestamp', 'desc')
  .limit(1)

query.onSnapshot((snapshot) => {
  snapshot.forEach(async (doc) => {
    const SubmissionID = doc.id
    const submission = doc.data()

    const TaskID = submission.taskID
    const taskDoc = await admin.firestore().doc(`tasks/${TaskID}`).get()

    const task = taskDoc.data()

    const codelen = task.type === 'normal' ? 1 : task.fileName.length

    const Code = await readCode(SubmissionID, codelen)

    const TargLang = submission.language

    const temp = {
      SubmissionID,
      TaskID,
      TargLang,
      Code,
    }
    axios.post(`http://localhost:${process.env.OUTPORT}`, temp)
  })
})
