const express = require("express");
const { execFile, exec } = require("child_process");
const { Queue, Worker } = require("bullmq");
const path = require("path");
require("dotenv").config();

const app = express();
const queue = new Queue("video-download-queue", {
  connection: { host: "127.0.0.1", port: 6379 }
});

app.use(express.json());
app.use(require("cors")());



// Helper function to get video details
// const getVideoDetails = (url) => {
//     console.log('Extracting video details:', url);
//     return new Promise((resolve, reject) => {
//       // Run yt-dlp to extract video details
//       exec(`yt-dlp -j ${url}`, (error, stdout, stderr) => {
//         if (error || stderr) {
//           reject(`Error: ${stderr || error.message}`);
//         }
//         try {
//           // Parse the JSON output from yt-dlp
//           const videoDetails = JSON.parse(stdout);
//           resolve(videoDetails);
//         } catch (e) {
//             console.log('Error parsing video details:', e.message);
//           reject(`Error parsing video details: ${e.message}`);
//         }
//       });
//     });
//   };

// const getVideoDetails = (url) => {
//     console.log('Extracting video details:', url);
//     return new Promise((resolve, reject) => {
//       // Run yt-dlp to extract video details
//     //   exec(`yt-dlp -j ${url}`, (error, stdout, stderr) => {
//     exec(`yt-dlp --extractor-args "generic:impersonate" -j ${url}`, (error, stdout, stderr) => {
//         if (error || stderr) {
//           console.log('Error or stderr:', stderr || error.message);
//           reject(`Error: ${stderr || error.message}`);
//           return;
//         }
//         console.log('stdout:', stdout); // Log the output before parsing
//         try {
//           // Parse the JSON output from yt-dlp
//           const videoDetails = JSON.parse(stdout);
//           resolve(videoDetails);
//         } catch (e) {
//           console.log('Error parsing video details:', e.message);
//           reject(`Error parsing video details: ${e.message}`);
//         }
//       });
//     });
//   };


//   // Route to handle video details extraction
//   app.post('/extract-video-details', async (req, res) => {
//     const { url } = req.body;

//     console.log('Received request:', req.body);

//     if (!url) {
//       return res.status(400).json({ error: 'URL is required' });
//     }

//     try {
//       const videoDetails = await getVideoDetails(url);
//       console.log('Video details:', videoDetails);
//       res.json(videoDetails);
//     } catch (error) {
//       res.status(500).json({ error: error.message });
//     }
//   });



const getVideoDetails = (url) => {
  console.log('Extracting video details:', url);
  return new Promise((resolve, reject) => {
    // Run yt-dlp to extract video details with --no-check-certificate to bypass SSL validation
    exec(`yt-dlp --no-check-certificate --socket-timeout 60 --extractor-args "generic:impersonate" -j "${url}"`, (error, stdout, stderr) => {
      // exec(`yt-dlp --no-check-certificate --socket-timeout 60 --force-generic-extractor -j "${url}"`, (error, stdout, stderr) => {
    // exec(`yt-dlp --no-check-certificate --socket-timeout 60 --extractor-args "generic:impersonate" --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" -j "${url}"`, (error, stdout, stderr) => {

      // exec(`yt-dlp --legacy-server-connect --no-check-certificate -j "${url}"`, (error, stdout, stderr) => {

        // exec(`yt-dlp --no-check-certificate --extractor-args "xhamster:protocol=https" -j "${url}"`, (error, stdout, stderr) => {

          // exec(`yt-dlp --cookies cookies.txt -j "${url}"`, (error, stdout, stderr) => {





      if (error || stderr) {
        console.log('Error or stderr:', stderr || error.message);
        reject(`Error: ${stderr || error.message}`);
        return;
      }
      console.log('stdout:', stdout); // Log the output before parsing
      try {
        // Parse the JSON output from yt-dlp
        const videoDetails = JSON.parse(stdout);
        resolve(videoDetails);
      } catch (e) {
        console.log('Error parsing video details:', e.message);
        reject(`Error parsing video details: ${e.message}`);
      }
    });
  });
};

// Route to handle video details extraction
app.post('/extract-video-details', async (req, res) => {
  const { url } = req.body;

  console.log('Received request:', req.body);

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const videoDetails = await getVideoDetails(url);
    console.log('Video details:', videoDetails);
    res.json(videoDetails);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



app.post("/download", async (req, res) => {
  console.log('Received request:', req.body);

  const { url, format = "mp4" } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    const job = await queue.add('download', { url, format }, {
      timeout: 600000,
      attempts: 3,
    });

    if (!job || !job.id) {
      console.error("Job creation failed!");
      return res.status(500).json({ error: "Failed to create job" });
    }

    console.log('Created job:', job.id);
    return res.json({ message: "Download started", jobId: job.id });

  } catch (error) {
    console.error("Error creating job:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Worker to process video downloads

new Worker("video-download-queue", async (job) => {
  const { url, format } = job.data;
  const outputPath = path.join(__dirname, "downloads", "%(title)s.%(ext)s");
  const command = ["-f", "best", "-o", outputPath, url];

  console.log(`Processing job ${job.id} - Downloading: ${url}`);

  return new Promise((resolve, reject) => {
    const process = execFile("yt-dlp", command);

    process.stdout.on("data", async (data) => {
      console.log(`Job ${job.id} output:`, data);

      // Extract percentage from yt-dlp output
      const match = data.match(/(\d+(\.\d+)?)%/);
      if (match) {
        const progress = parseFloat(match[1]);
        await job.updateProgress(progress); // Update job progress
      }
    });

    process.stderr.on("data", (data) => {
      console.warn(`Job ${job.id} warning:`, data);
    });

    process.on("close", async (code) => {
      if (code === 0) {
        console.log(`Job ${job.id} completed successfully`);
        resolve({ message: "Download complete", jobId: job.id });
      } else {
        console.error(`Job ${job.id} failed with exit code ${code}`);
        reject(new Error("Download failed"));
      }
    });

    process.on("error", async (error) => {
      console.error(`Error in job ${job.id}:`, error);
      reject(error);
    });
  });
}, { connection: { host: "127.0.0.1", port: 6379 } });


// new Worker("video-download-queue", async (job) => {
//     const { url, format } = job.data;
//     const outputPath = path.join(__dirname, "downloads", "%(title)s.%(ext)s");
//     const command = ["-f", "best", "-o", outputPath, url];

//     console.log(`Processing job ${job.id} - Downloading: ${url}`);

//     return new Promise((resolve, reject) => {
//         const process = execFile("yt-dlp", command);

//         process.stdout.on("data", async (data) => {
//             console.log(`Job ${job.id} output:`, data);

//             // Extract percentage from yt-dlp output
//             const match = data.match(/(\d+(\.\d+)?)%/);
//             if (match) {
//                 const progress = parseFloat(match[1]);
//                 await job.updateProgress(progress); // Update job progress
//             }
//         });

//         process.stderr.on("data", (data) => {
//             console.warn(`Job ${job.id} warning:`, data);
//         });

//         process.on("close", async (code) => {
//             if (code === 0) {
//                 console.log(`Job ${job.id} completed successfully`);
//                 await job.moveToCompleted("Download complete");
//                 resolve({ message: "Download complete", jobId: job.id });
//             } else {
//                 console.error(`Job ${job.id} failed with exit code ${code}`);
//                 await job.moveToFailed({ message: "Download failed" });
//                 reject(new Error("Download failed"));
//             }
//         });

//         process.on("error", async (error) => {
//             console.error(`Error in job ${job.id}:`, error);
//             await job.moveToFailed({ message: error.message });
//             reject(error);
//         });
//     });
// }, { connection: { host: "127.0.0.1", port: 6379 } });

// API to check job status
app.get("/job-status/:jobId", async (req, res) => {
  const job = await queue.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  const state = await job.getState(); // 'waiting', 'active', 'completed', 'failed'
  const progress = await job.progress || 0; // Get progress percentage
  const result = await job.returnvalue || null; // Get final result if completed

  return res.json({ id: job.id, state, progress, result });
});

app.listen(3000, () => console.log("Downloader service running on port 3000"));
