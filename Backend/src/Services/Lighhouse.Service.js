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

const {
    requestedUrl,
    fetchTime,
    categories: {
        performance,
        accessibility,
        "best-practices": bestPractices,
        seo
    },
    audits: {
        "first-contentful-paint": fcp,
        "largest-contentful-paint": lcp,
        "speed-index": speedIndex,
        "total-blocking-time": tbt,
        "cumulative-layout-shift": cls,
        interactive
    }  } = result.lhr;


    return {
    requestedUrl,
    fetchTime,

    scores: {
        performance: Math.round(performance.score * 100),
        accessibility: Math.round(accessibility.score * 100),
        bestPractices: Math.round(bestPractices.score * 100),
        seo: Math.round(seo.score * 100)
    },

    metrics: {
        fcp: fcp.numericValue,
        lcp: lcp.numericValue,
        speedIndex: speedIndex.numericValue,
        tbt: tbt.numericValue,
        cls: cls.numericValue,
        interactive: interactive.numericValue
    }
};




    }catch (error) {
        console.error(`[Lighthouse Error] Failed to audit ${url}:`, error.message);
        throw new Error(`Audit failed for ${url}: ${error.message}`) 
   
         } finally{ 
            if (chrome) {
             try {

            chrome.kill();

        } catch (error) {
            console.error("Failed to cleanup Chrome:", error.message);
        }
    }
    }
}