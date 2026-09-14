import * as chromeLauncher from "chrome-launcher"
import lighthouse from "lighthouse"

export const lighthouseReport = async(url)=>{

    let chrome

    try{

    chrome = await chromeLauncher.launch({
        chromeFlags : [
           '--headless',  // help running chrom in bg without ui
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu', // Prevents GPU-related crashes on servers
        '--no-first-run', // Skips Chrome welcome screen
        '--no-default-browser-check',
        '--mute-audio', // Saves processing power
        '--ignore-certificate-errors' // Helpful for testing staging environments
        ]
    })

    const option ={
        port : chrome.port, // this is how lighthouse is conneccted to chromelauncher using chromelauncher port 
        output : "json",  
        logLevel : "error",
        onlyCategories: [       // fetch result related to this 
                'performance',
                'accessibility',
                'best-practices',
                'seo'
            ],

    }

    const result = await lighthouse(url, option)
     if (!result) {
            throw new Error('Lighthouse failed to generate report');
        }


     return result.lhr;




    }catch (error) {
        console.error(`[Lighthouse Error] Failed to audit ${url}:`, error.message);
        throw new Error(`Audit failed for ${url}: ${error.message}`) 
   
         } finally{
        
            if(chrome){ chrome.kill()}
    }
}