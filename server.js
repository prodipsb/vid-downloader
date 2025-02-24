const express = require("express");
const { exec, execFile } = require("child_process");
const { Queue, Worker } = require("bullmq"); // Ensure both are imported
const path = require("path");
require("dotenv").config();

const app = express();
const queue = new Queue("video-download-queue", { 
    connection: { host: "127.0.0.1", port: 6379 } 
});

app.use(express.json());
app.use(require("cors")());

// Add download request to queue
app.post("/download", async (req, res) => {
    console.log('req.body', req.body);
    const { url, format = "mp4" } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    const job = await queue.add('download', { url, format }, {
        timeout: 600000,  // Timeout after 600 seconds
        attempts: 3,     // Retry up to 3 times
    });

    // const job = await queue.add("download", { url, format });
    console.log('currect job', job);
    res.json({ message: "Download started", jobId: job.id });
});

// Process the queue using Worker (Fixes issue)
new Worker("video-download-queue", async (job) => {
    const { url, format } = job.data;
    const outputPath = path.join(__dirname, "downloads", "%(title)s.%(ext)s");

    const command = ["-f", "best", "-o", outputPath, url];

    console.log('outputPath', outputPath);

    return new Promise((resolve, reject) => {
        execFile("yt-dlp", command, (error, stdout, stderr) => {
            if (error) return reject(`Error: ${error.message}`);
            if (stderr) console.warn(`Warning: ${stderr}`);
            resolve(`Downloaded: ${stdout}`);
        });
        // exec(`yt-dlp -f best -o "${outputPath}" ${url}`, (error, stdout, stderr) => {
        //     if (error) return reject(`Error: ${error.message}`);
        //     if (stderr) console.warn(`Warning: ${stderr}`);
        //     resolve(`Downloaded: ${stdout}`);
        // });
    });
}, { connection: { host: "127.0.0.1", port: 6379 } });

// API to check job status
app.get("/status/:id", async (req, res) => {
    console.log('req.params.id', req.params.id);
    const job = await queue.getJob(req.params.id);
    console.log('job', job);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const state = await job.getState();
    res.json({ id: job.id, state, progress: job.progress });
});

app.listen(3000, () => console.log("Downloader service running on port 3000"));
