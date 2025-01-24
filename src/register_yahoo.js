const { logMessage, rl } = require("./utils/logger");
const ariChain = require("./classes/ariChain");

const chalk = require("chalk");
const fs = require("fs");
const path = require("path");
const Imap = require('imap');


// Add new IMAP configuration function
function getImapConfig(email, password) {
    return {
        user: email,
        password: password,
        host: 'imap.mail.yahoo.com',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false }
    };
}

// Add Yahoo IMAP connection function
async function checkYahooMail(email, password) {
    return new Promise((resolve, reject) => {
        const imap = new Imap(getImapConfig(email, password));
        
        imap.once('ready', () => {
            imap.openBox('INBOX', false, (err, box) => {
                if (err) reject(err);
                
                // Search for recent emails
                const searchCriteria = ['UNSEEN', ['SINCE', new Date(Date.now() - 1000 * 60 * 5)]];
                imap.search(searchCriteria, (err, results) => {
                    if (err) reject(err);
                    
                    if (results.length > 0) {
                        const f = imap.fetch(results, { bodies: '' });
                        f.on('message', (msg) => {
                            msg.on('body', (stream) => {
                                let buffer = '';
                                stream.on('data', (chunk) => {
                                    buffer += chunk.toString('utf8');
                                });
                                stream.once('end', () => {
                                    resolve(buffer);
                                });
                            });
                        });
                        f.once('error', reject);
                        f.once('end', () => {
                            imap.end();
                        });
                    } else {
                        resolve(null);
                    }
                });
            });
        });

        imap.once('error', reject);
        imap.connect();
    });
}

// Add function to read Yahoo accounts
function loadYahooAccounts() {
    const accountsPath = path.resolve(__dirname, '../config/register.txt');
    try {
        const content = fs.readFileSync(accountsPath, 'utf8');
        return content.split('\n')
            .map(line => line.trim())
            .filter(line => line)
            .map(line => {
                const [email, password] = line.split(':');
                return { email: email.trim(), password: password.trim() };
            });
    } catch (error) {
        console.error(chalk.red('Error reading Yahoo accounts file:', error.message));
        return [];
    }
}

async function main() {
  // Load Yahoo accounts
  const yahooAccounts = loadYahooAccounts();
  if (yahooAccounts.length === 0) {
      console.error(chalk.red('No Yahoo accounts found in register.txt'));
      process.exit(1);
  }

  // Use number of accounts as count
  const count = yahooAccounts.length;
  console.log(chalk.green(`Using ${count} accounts from register.txt`));

  const use2CaptchaResponse = "y";
  const use2Captcha = use2CaptchaResponse.toLowerCase() === "y";
  const refCode = "678d1bfc5f6df";
  const toAddress = "ARW7GNYDyrBRRDavrue4Ld4GMw5zuMv8H1brm57sxTm4ByFtAENwb";
  let successful = 0;

  const accountAri = fs.createWriteStream("../result/accounts.txt", { flags: "a" });

  for (let i = 0; i < count; i++) {
    console.log(chalk.white("-".repeat(85)));
    logMessage(i + 1, count, "Process", "debug");

    // Use matching indexes for both Yahoo account and proxy
    const accountIndex = i % yahooAccounts.length;
    const yahooAccount = yahooAccounts[accountIndex];
    // Get proxy with same index as Yahoo account
    const currentProxy = await getProxyByIndex(accountIndex);
    const generator = new ariChain(refCode, currentProxy);

    try {
      // Use Yahoo mail for verification

      const email = yahooAccount.email;
      const password = yahooAccount.password;

      const emailSent = await generator.sendEmailCode(email, use2Captcha);
      if (!emailSent) continue;

      const account = await generator.registerAccount(email, password);

      if (account) {
        accountAri.write(`ID: ${account.result.session_code}\n`);
        accountAri.write(`Email: ${email}\n`);
        accountAri.write(`Password: ${password}\n`);
        //accountAri.write(`Reff To: ${refCode}\n`);
        accountAri.write(`Address: ${account.result.address}\n`);
        accountAri.write(`Private Key: ${account.result.master_key}\n`);


        successful++;
        logMessage(i + 1, count, "Account Success Create!", "success");
        logMessage(i + 1, count, `Email: ${email}`, "success");
        logMessage(i + 1, count, `Password: ${password}`, "success");
        logMessage(i + 1, count, `Reff To : ${refCode}`, "success");

        const address = account.result.address;

        try {
          const checkinResult = await generator.checkinDaily(address);
          logMessage(i + 1, count, `Checkin Daily Done`, "success");
          if (!checkinResult) {
            throw new Error("Failed to checkin");
          }
          const transferResult = await generator.transferToken(
            email,
            toAddress,
            password,
            60
          );
          if (!transferResult) {
            throw new Error("Failed to transfer token");
          }
          logMessage(i + 1, count, `Transfer Token Done`, "success");
        } catch (error) {
          logMessage(i + 1, count, error.message, "error");
          continue;
        }
      } else {
        logMessage(i + 1, count, "Register Account Failed", "error");
        if (generator.proxy) {
          logMessage(i + 1, count, `Failed proxy: ${generator.proxy}`, "error");
        }
      }
    } catch (error) {
      logMessage(i + 1, count, `Error occurred: ${error.message}`, "error");
    }
  }

  accountAri.end();

  console.log(chalk.green(`[*] Successfully created ${successful} out of ${count} accounts`));
  console.log(chalk.magenta("[*] Result in accounts.txt"));
  rl.close();
}

// Add new function to get proxy by index
async function getProxyByIndex(index) {
  try {
    const proxies = fs.readFileSync('../config/proxy.txt', 'utf8')
      .split('\n')
      .filter(line => line.trim());
    
    return proxies[index % proxies.length] || null;
  } catch (error) {
    console.error(chalk.red('Error reading proxies:', error.message));
    return null;
  }
}

main();
