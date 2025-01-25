const fs = require('fs');
const path = require('path');
const { logMessage, rl } = require("./utils/logger");
const ariChain = require("./classes/ariChain");
const { getRandomProxy, loadProxies } = require("./classes/proxy");
const chalk = require("chalk");

// Read accounts from daily_accounts.txt
function readAccounts() {
    const data = fs.readFileSync(path.join(__dirname, '../config/daily_accounts.txt'), 'utf-8');
    const lines = data.split('\n');
    const accounts = [];
    let account = {};
    
    for (let line of lines) {
        if (line.startsWith('ID:')) {
            if (Object.keys(account).length > 0) {
                accounts.push(account);
            }
            account = {};
        }
        if (line.startsWith('Email:')) {
            account.email = line.split('Email: ')[1].trim();
        } else if (line.startsWith('Password:')) {
            account.password = line.split('Password: ')[1].trim();
        } else if (line.startsWith('Address:')) {
            account.address = line.split('Address: ')[1].trim();
        }
    }
    if (Object.keys(account).length > 0) {
        accounts.push(account);
    }
    return accounts;
}

// Read proxies directly from file
function readProxies() {
    try {
        const data = fs.readFileSync(path.join(__dirname, '../config/proxy.txt'), 'utf-8');
        return data.split('\n').filter(line => line.trim());
    } catch (error) {
        console.error('Error reading proxies:', error);
        return [];
    }
}

// Read toAddress from config file
function readToAddress() {
    return fs.readFileSync(path.join(__dirname, '../config/toAddress.txt'), 'utf-8').trim();
}

function printQuizResult(result) {
    console.log('Quiz Result:');
    console.log(`Status: ${result.status}`);
    if (result.result) {
        console.log('Result:');
        console.log(`  History: ${result.result.history}`);
        console.log(`  Quiz Index: ${result.result.quiz_idx}`);
        console.log(`  Quiz Title: ${result.result.quiz_title}`);
        console.log('  Quiz Questions:');
        result.result.quiz_q.forEach((q, index) => {
            console.log(`    Question ${index + 1}: ${JSON.stringify(q)}`);
        });
        console.log('  Rewards:');
        result.result.reward.forEach((r, index) => {
            console.log(`    Reward ${index + 1}: ${JSON.stringify(r)}`);
        });
    }
    console.log(`Token: ${result.token}`);
}

async function main() {
    console.log("Starting daily process...");
    
    try {
        const accounts = readAccounts();
        const proxies = readProxies();
        console.log(`Loaded ${accounts.length} accounts and ${proxies.length} proxies`);
        
        const toAddress = readToAddress();
        console.log(`Target address: ${toAddress}`);
        
        const count = accounts.length;

        for (let i = 0; i < count; i++) {
            console.log(`\nProcessing account ${i + 1}/${count}`);
            // Use matching proxy index, wrap around if needed
            const currentProxy = proxies[i % proxies.length];
            console.log(`Using proxy: ${currentProxy || 'none'}`);
            
            const generator = new ariChain("", currentProxy);
            const { email, password, address } = accounts[i];
            console.log(`Account details - Email: ${email}, Address: ${address}`);

            try {
                console.log('Attempting daily getQuizResult...');
                const getQuizResult = await generator.getQuiz(address);
                printQuizResult(getQuizResult);
                
                logMessage(i + 1, count, `getQuizResult Daily Done`, "success");
                await new Promise(resolve => setTimeout(resolve, 1000));

                if (!getQuizResult) {
                    throw new Error("Failed to getQuizResult");
                }

                const quizIdx = 122;
                const answerIdx = 406;
                //console.log(`Setting quiz with payload: { address: ${address}, quiz_idx: ${quizIdx}, answer_idx: ${answerIdx} }`);
                const setQuizResult = await generator.setQuiz(address, quizIdx, answerIdx);
                console.log('setQuizResult response:', setQuizResult);
                  
                if (setQuizResult.status !== 'success') {
                    logMessage(i + 1, count, `setQuizResult Daily Done`, "failed");
                    continue;
                }
                logMessage(i + 1, count, `setQuizResult Daily Done`, "success");
                await new Promise(resolve => setTimeout(resolve, 1000));


                console.log('Attempting token transfer...');
                const transferResult = await generator.transferToken(
                    email,
                    toAddress,
                    password,
                    10
                );
                console.log('Transfer response:', transferResult);

                if (!transferResult) {
                    throw new Error("Failed to transfer token");
                }
                logMessage(i + 1, count, `Transfer Token Done`, "success");
                
            } catch (error) {
                console.error('Error details:', error);
                logMessage(i + 1, count, `Error: ${error.message}`, "error");
                if (generator.proxy) {
                    logMessage(i + 1, count, `Failed proxy: ${generator.proxy}`, "error");
                }
                continue;
            }
        }
    } catch (error) {
        console.error('Fatal error:', error);
    }

    console.log("Daily process completed");
    rl.close();
}

main();