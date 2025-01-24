const axios = require("axios");
const { Solver } = require("@2captcha/captcha-solver");
const { google } = require("googleapis");
const { logMessage } = require("../utils/logger");
const { getProxyAgent } = require("./proxy");
const fs = require("fs");
const { EmailGenerator } = require("../utils/generator");
const path = require("path");
const Imap = require('imap');  // Add this line
const TOKEN_PATH = path.join(__dirname, "../json/token.json");
const confEmail = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../json/client_secret.json"))
).email;
const confApi = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../json/client_secret.json"))
).geminiApi;
const gemeiniPrompt = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../json/client_secret.json"))
).prompt;
const captchaApi = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../json/client_secret.json"))
).captha2Apikey;
const qs = require("qs");
const { GoogleGenerativeAI } = require("@google/generative-ai");

function loadOAuth2Client() {
  const credentials = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../json/client_secret.json"))
  );
  const { client_id, client_secret, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

class ariChain {
  constructor(refCode, proxy = null) {
    this.refCode = refCode;
    this.proxy = proxy;
    this.axiosConfig = {
      ...(this.proxy && { httpsAgent: getProxyAgent(this.proxy) }),
      timeout: 60000,
    };
    this.gmailClient = google.gmail({
      version: "v1",
      auth: loadOAuth2Client(),
    });
    this.baseEmail = confEmail;
    this.gemini = new GoogleGenerativeAI(confApi);
    this.model = this.gemini.getGenerativeModel({
      model: "gemini-1.5-flash",
    });
    this.twoCaptchaSolver = new Solver(captchaApi);
    this.imap = Imap;  // Add this line to make Imap available in class methods
  }

  async makeRequest(method, url, config = {}) {
    try {
      const response = await axios({
        method,
        url,
        ...this.axiosConfig,
        ...config,
      });
      return response;
    } catch (error) {
      logMessage(
        this.currentNum,
        this.total,
        `Request failed: ${error.message}`,
        "error"
      );
      if (this.proxy) {
        logMessage(
          this.currentNum,
          this.total,
          `Failed proxy: ${this.proxy}`,
          "error"
        );
      }
      return null;
    }
  }

  generateTempEmail() {
    const emailGenerator = new EmailGenerator(this.baseEmail);
    const tempEmail = emailGenerator.generateRandomVariation();
    logMessage(
      this.currentNum,
      this.total,
      `Email using: ${tempEmail}`,
      "success"
    );
    return tempEmail;
  }

  async getCaptchaCode() {
    try {
      const headers = {
        accept: "*/*",
      };
      const response = await this.makeRequest(
        "POST",
        "https://arichain.io/api/captcha/create",
        { headers }
      );

      return response;
    } catch {
      console.error("Error create captcha :", error);
      return null;
    }
  }

  async getCaptchaImage(uniqueIdx) {
    try {
      const response = await this.makeRequest(
        "GET",
        `http://arichain.io/api/captcha/get?unique_idx=${uniqueIdx}`,
        { responseType: "arraybuffer" }
      );
      return response.data;
    } catch {
      console.error("Error get image captcha:", error);
      return null;
    }
  }

  async solveCaptchaWithGemini(imageBuffer) {
    try {
      const prompt = gemeiniPrompt;
      const image = {
        inlineData: {
          data: Buffer.from(imageBuffer).toString("base64"),
          mimeType: "image/png",
        },
      };

      const result = await this.model.generateContent([prompt, image]);
      const captchaText = result.response.text().trim();
      const cleanedCaptchaText = captchaText.replace(/\s/g, "");

      logMessage(
        this.currentNum,
        this.total,
        "Solve captcha done...",
        "success"
      );
      return cleanedCaptchaText;
    } catch (error) {
      console.error("Error solving CAPTCHA with Gemini:", error);
      return null;
    }
  }

  async solveCaptchaWith2Captcha(imageBuffer) {
    try {
      const base64Image = Buffer.from(imageBuffer).toString("base64");
      const res = await this.twoCaptchaSolver.imageCaptcha({
        body: `data:image/png;base64,${base64Image}`,
        regsense: 1,
      });

      return res.data;
    } catch (error) {
      console.error("Error solving CAPTCHA with 2Captcha:", error);
      return null;
    }
  }

  async sendEmailCode(email, use2Captcha = false) {
    logMessage(
      this.currentNum,
      this.total,
      "Processing send email code...",
      "process"
    );

    let captchaResponse;
    let captchaText;
    let response;
    const maxAttempts = 3;
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      logMessage(
        this.currentNum,
        this.total,
        `Attempt ${attempts} to solve CAPTCHA...`,
        "process"
      );

      captchaResponse = await this.getCaptchaCode();
      if (
        !captchaResponse ||
        !captchaResponse.data ||
        !captchaResponse.data.result
      ) {
        logMessage(
          this.currentNum,
          this.total,
          "Failed to get CAPTCHA",
          "error"
        );
        continue;
      }

      const uniqueIdx = captchaResponse.data.result.unique_idx;

      const captchaImageBuffer = await this.getCaptchaImage(uniqueIdx);
      if (!captchaImageBuffer) {
        logMessage(
          this.currentNum,
          this.total,
          "Failed to get CAPTCHA image",
          "error"
        );
        continue;
      }

      if (use2Captcha) {
        captchaText = await this.solveCaptchaWith2Captcha(captchaImageBuffer);
      } else {
        captchaText = await this.solveCaptchaWithGemini(captchaImageBuffer);
      }

      if (!captchaText) {
        logMessage(
          this.currentNum,
          this.total,
          "Failed to solve CAPTCHA",
          "error"
        );
        continue;
      }

      const headers = {
        accept: "*/*",
        "content-type": "application/x-www-form-urlencoded",
      };

      const data = qs.stringify({
        email: email,
        unique_idx: uniqueIdx,
        captcha_string: captchaText,
      });

      response = await this.makeRequest(
        "POST",
        "https://arichain.io/api/Email/send_valid_email",
        { headers, data }
      );

      if (!response) {
        logMessage(
          this.currentNum,
          this.total,
          "Failed to send email",
          "error"
        );
        continue;
      }

      if (response.data.status === "fail") {
        if (response.data.msg === "captcha is not valid") {
          logMessage(
            this.currentNum,
            this.total,
            "CAPTCHA is not valid, retrying...",
            "warning"
          );
          continue;
        } else {
          logMessage(this.currentNum, this.total, response.data.msg, "error");
          return false;
        }
      }

      logMessage(
        this.currentNum,
        this.total,
        "Email sent successfully",
        "success"
      );
      return true;
    }

    logMessage(
      this.currentNum,
      this.total,
      "Failed to send email after multiple attempts",
      "error"
    );
    return false;
  }

  async getCodeFromYahooMail(email, password) {
    return new Promise((resolve, reject) => {
      const imap = new this.imap({  // Use this.imap instead of Imap
        user: email,
        password: password,
        host: 'imap.mail.yahoo.com',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false }
      });

      logMessage(this.currentNum, this.total, `Connecting to Yahoo Mail: ${email}`, "process");

      imap.once('ready', () => {
        logMessage(this.currentNum, this.total, "Connected to Yahoo Mail", "success");
        
        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            logMessage(this.currentNum, this.total, `Error opening inbox: ${err.message}`, "error");
            imap.end();
            reject(err);
            return;
          }

          logMessage(this.currentNum, this.total, "Searching for verification email", "process");
          // Search for recent emails with exact subject - increase time window to 15 minutes
          const searchCriteria = [
            ['SINCE', new Date(Date.now() - 1000 * 60 * 15)],
            ['SUBJECT', 'ARI E-mail validation code']
          ];

          imap.search(searchCriteria, (err, results) => {
            if (err) {
              logMessage(this.currentNum, this.total, `Search error: ${err.message}`, "error");
              imap.end();
              resolve(null);
              return;
            }

            if (!results.length) {
              logMessage(this.currentNum, this.total, "No matching emails found", "warning");
              imap.end();
              resolve(null);
              return;
            }

            logMessage(this.currentNum, this.total, `Found ${results.length} matching emails`, "success");

            const f = imap.fetch(results, { bodies: '' });
            let verification_code = null;

            f.on('message', (msg) => {
              msg.on('body', (stream) => {
                let buffer = '';
                stream.on('data', (chunk) => buffer += chunk.toString('utf8'));
                stream.once('end', () => {
                  logMessage(this.currentNum, this.total, "Processing email content", "process");
                  
                  // Try to find the code in the specific HTML structure first
                  const htmlMatch = buffer.match(/<b[^>]*>(\d{6})<\/b>/);
                  if (htmlMatch && htmlMatch[1] && !verification_code) { // Only set if not already found
                    verification_code = htmlMatch[1];
                    logMessage(this.currentNum, this.total, `Found first verification code in HTML: ${verification_code}`, "success");
                  }
                });
              });
            });

            f.once('end', () => {
              imap.end();
              if (verification_code) {
                logMessage(this.currentNum, this.total, `Using first verification code found: ${verification_code}`, "success");
              }
              resolve(verification_code);
            });
          });
        });
      });

      imap.once('error', (err) => {
        logMessage(this.currentNum, this.total, `IMAP error: ${err.message}`, "error");
        imap.end();
        reject(err);
      });

      imap.connect();
    });
  }

  async getCodeVerification(email, password) {
    logMessage(this.currentNum, this.total, "Waiting for code verification...", "process");

    const maxAttempts = 8; // Increased from 5 to 8 attempts
    const waitTime = 15000; // Increased from 10 to 15 seconds

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      logMessage(this.currentNum, this.total, `Attempt ${attempt + 1}/${maxAttempts}`, "process");
      await new Promise(resolve => setTimeout(resolve, waitTime));

      try {
        let verificationCode = null;

        if (email.includes('@yahoo.com')) {
          logMessage(this.currentNum, this.total, "Using Yahoo Mail verification method", "process");
          verificationCode = await this.getCodeFromYahooMail(email, password);
        } else {
          logMessage(this.currentNum, this.total, "Using Gmail verification method", "process");
          const messages = await this.gmailClient.users.messages.list({
            userId: 'me',
            q: `to:${email}`,
          });
          
          if (messages.data.messages && messages.data.messages.length > 0) {
            const message = await this.gmailClient.users.messages.get({
              userId: 'me',
              id: messages.data.messages[0].id,
            });

            const emailBody = Buffer.from(message.data.payload.body.data, 'base64').toString('utf8');
            const codeMatch = emailBody.match(/\b\d{6}\b/);
            if (codeMatch) {
              verificationCode = codeMatch[0];
            }
          }
        }

        if (verificationCode) {
          logMessage(this.currentNum, this.total, `Verification code found: ${verificationCode}`, "success");
          return verificationCode;
        }
      } catch (error) {
        logMessage(this.currentNum, this.total, `Error checking email: ${error.message}`, "error");
      }

      logMessage(
        this.currentNum, 
        this.total, 
        `Verification code not found. Waiting ${waitTime/1000} seconds before next attempt...`, 
        "warning"
      );
    }

    logMessage(this.currentNum, this.total, "Failed to get verification code after all attempts", "error");
    return null;
  }

  loadEmailAccounts(filePath) {
    try {
      const content = fs.readFileSync(path.resolve(__dirname, filePath), 'utf8');
      return content.split('\n')
        .map(line => line.trim())
        .filter(line => line)
        .map(line => {
          const [email, password] = line.split(':');
          return { email: email.trim(), password: password.trim() };
        });
    } catch (error) {
      console.error('Error reading email accounts:', error.message);
      return [];
    }
  }

  async checkinDaily(address) {
    const headers = {
      accept: "*/*",
      "content-type": "application/x-www-form-urlencoded",
    };
    const data = qs.stringify({ address });
    const response = await this.makeRequest(
      "POST",
      "https://arichain.io/api/event/checkin",
      {
        headers,
        data,
      }
    );
    if (!response) {
      logMessage(this.currentNum, this.total, "Failed checkin", "error");
      return null;
    }
    return response.data;
  }

  async transferToken(email, toAddress, password, amount = 60) {
    const headers = {
      accept: "*/*",
      "content-type": "application/x-www-form-urlencoded",
    };
    const transferData = qs.stringify({
      email,
      to_address: toAddress,
      pw: password,
      amount,
    });
    const response = await this.makeRequest(
      "POST",
      "https://arichain.io/api/wallet/transfer_mobile",
      {
        headers,
        data: transferData,
      }
    );
    if (!response) {
      logMessage(this.currentNum, this.total, "Failed send token", "error");
      return null;
    }
    return response.data;
  }

  async registerAccount(email, password) {
    logMessage(this.currentNum, this.total, "Register account...", "process");

    const verifyCode = await this.getCodeVerification(email,password);
    if (!verifyCode) {
      logMessage(
        this.currentNum,
        this.total,
        "Failed get code verification.",
        "error"
      );
      return null;
    }

    const headers = {
      accept: "*/*",
      "content-type": "application/x-www-form-urlencoded",
    };

    const registerData = qs.stringify({
      email: email,
      pw: password,
      pw_re: password,
      valid_code: verifyCode,
      invite_code: this.refCode,
    });

    const response = await this.makeRequest(
      "POST",
      "https://arichain.io/api/Account/signup",
      {
        headers,
        data: registerData,
      }
    );

    if (response.data.status === "fail") {
      logMessage(this.currentNum, this.total, response.data.msg, "error");
      return null;
    }

    logMessage(this.currentNum, this.total, "Register succes.", "success");

    return response.data;
  }
}

module.exports = ariChain;
