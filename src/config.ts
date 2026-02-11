/**
 * Configuration module for AusLaw MCP
 * Loads configuration from environment variables with defaults
 */

export interface Config {
  austlii: {
    searchBase: string;
    referer: string;
    userAgent: string;
    timeout: number;
  };
  ocr: {
    language: string;
    oem: number;
    psm: number;
  };
  defaults: {
    searchLimit: number;
    maxSearchLimit: number;
    outputFormat: string;
    sortBy: string;
  };
}

/**
 * Load configuration from environment variables with defaults
 */
export function loadConfig(): Config {
  return {
    austlii: {
      searchBase: process.env.AUSTLII_SEARCH_BASE || 
        "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
      referer: process.env.AUSTLII_REFERER || 
        "https://www.austlii.edu.au/forms/search1.html",
      userAgent: process.env.AUSTLII_USER_AGENT || 
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      timeout: parseInt(process.env.AUSTLII_TIMEOUT || "60000", 10), // AustLII can be slow
    },
    ocr: {
      language: process.env.OCR_LANGUAGE || "eng",
      oem: parseInt(process.env.OCR_OEM || "1", 10),
      psm: parseInt(process.env.OCR_PSM || "3", 10),
    },
    defaults: {
      searchLimit: parseInt(process.env.DEFAULT_SEARCH_LIMIT || "10", 10),
      maxSearchLimit: parseInt(process.env.MAX_SEARCH_LIMIT || "50", 10),
      outputFormat: process.env.DEFAULT_OUTPUT_FORMAT || "json",
      sortBy: process.env.DEFAULT_SORT_BY || "auto",
    },
  };
}

// Export a singleton instance
export const config = loadConfig();
